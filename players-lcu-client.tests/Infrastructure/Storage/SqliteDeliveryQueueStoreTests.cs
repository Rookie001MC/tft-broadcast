using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Infrastructure.Storage;

namespace players_lcu_client.tests.Infrastructure.Storage;

public sealed class SqliteDeliveryQueueStoreTests : IDisposable
{
    private readonly string _rootDirectory = Path.Combine(Path.GetTempPath(), $"TftPlayerRelayTests-{Guid.NewGuid():N}");

    [Fact]
    public async Task InitializeAsync_CreatesAFreshReadyQueue()
    {
        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Ready, result.Status);
        Assert.Equal(0, result.RecoveredInterruptedSendingCount);
        Assert.DoesNotContain(_rootDirectory, result.Detail);
        Assert.Equal(1L, await ReadSchemaVersionAsync());
        Assert.True(await TableExistsAsync("delivery_queue"));
        Assert.True(await TableExistsAsync("delivery_attempts"));
    }

    [Fact]
    public async Task InitializeAsync_AfterRestartRecoversOnlySendingWithoutChangingOtherPersistedFields()
    {
        var firstStore = CreateStore();
        await firstStore.InitializeAsync(CancellationToken.None);
        var interrupted = CreateItem("{\"gameId\":\"interrupted\"}");
        var acknowledged = CreateItem("{\"gameId\":\"acknowledged\"}");
        await firstStore.AdmitAsync(interrupted);
        await firstStore.AdmitAsync(acknowledged);
        await SeedInterruptedAndAcknowledgedRowsAsync(interrupted.Envelope.CaptureId, acknowledged.Envelope.CaptureId);
        var interruptedBefore = await ReadQueueFieldsExceptStateAsync(interrupted.Envelope.CaptureId);
        var acknowledgedBefore = await ReadQueueFieldsExceptStateAsync(acknowledged.Envelope.CaptureId);
        var attemptsBefore = await ReadAttemptRowsAsync();

        var restartedStore = CreateStore();
        var result = await restartedStore.InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Ready, result.Status);
        Assert.Equal(1, result.RecoveredInterruptedSendingCount);
        Assert.Equal(QueuedCaptureDeliveryState.Pending, await ReadDeliveryStateAsync(interrupted.Envelope.CaptureId));
        Assert.Equal(QueuedCaptureDeliveryState.Acknowledged, await ReadDeliveryStateAsync(acknowledged.Envelope.CaptureId));
        AssertRowsEqual(interruptedBefore, await ReadQueueFieldsExceptStateAsync(interrupted.Envelope.CaptureId));
        AssertRowsEqual(acknowledgedBefore, await ReadQueueFieldsExceptStateAsync(acknowledged.Envelope.CaptureId));
        AssertRowsEqual(attemptsBefore, await ReadAttemptRowsAsync());
    }

    [Fact]
    public async Task InitializeAsync_WhenCalledAgainOnSameInstanceDoesNotRecoverANewLiveSendingRow()
    {
        var store = CreateStore();
        var first = await store.InitializeAsync(CancellationToken.None);
        var item = CreateItem("{\"gameId\":\"live-send\"}");
        await store.AdmitAsync(item);
        await SetDeliveryStateAsync(item.Envelope.CaptureId, QueuedCaptureDeliveryState.Sending);

        var second = await store.InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Ready, second.Status);
        Assert.Equal(first.RecoveredInterruptedSendingCount, second.RecoveredInterruptedSendingCount);
        Assert.Equal(QueuedCaptureDeliveryState.Sending, await ReadDeliveryStateAsync(item.Envelope.CaptureId));
    }

    [Fact]
    public async Task InitializeAsync_WithFutureSchemaReturnsUnsupportedWithoutDestroyingData()
    {
        await CreateFutureSchemaAsync();
        var journalModeBefore = await ReadJournalModeAsync();

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.UnsupportedSchema, result.Status);
        Assert.Equal(0, result.RecoveredInterruptedSendingCount);
        Assert.DoesNotContain(_rootDirectory, result.Detail);
        Assert.Equal(2L, await ReadSchemaVersionAsync());
        Assert.Equal("preserve-me", await ReadSentinelAsync());
        Assert.False(await TableExistsAsync("delivery_queue"));
        Assert.Equal(journalModeBefore, await ReadJournalModeAsync());
    }

    [Fact]
    public async Task InitializeAsync_WithAdditiveFutureSchemaMetadataReturnsUnsupportedWithoutMutation()
    {
        await CreateFutureSchemaWithMetadataAsync();
        var journalModeBefore = await ReadJournalModeAsync();

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.UnsupportedSchema, result.Status);
        Assert.Equal(2L, await ReadSchemaVersionAsync());
        Assert.Equal("future-metadata", await ReadSchemaMetadataAsync());
        Assert.Equal("preserve-me", await ReadSentinelAsync());
        Assert.Equal(journalModeBefore, await ReadJournalModeAsync());
    }

    [Fact]
    public async Task InitializeAsync_WithCorruptDatabaseReturnsCorruptWithoutRecreatingIt()
    {
        Directory.CreateDirectory(_rootDirectory);
        var corruptBytes = Encoding.UTF8.GetBytes("not a sqlite database; preserve these bytes");
        await File.WriteAllBytesAsync(DatabasePath, corruptBytes);

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Corrupt, result.Status);
        Assert.Equal(0, result.RecoveredInterruptedSendingCount);
        Assert.DoesNotContain(_rootDirectory, result.Detail);
        Assert.Equal(corruptBytes, await File.ReadAllBytesAsync(DatabasePath));
    }

    [Fact]
    public async Task InitializeAsync_WithWeakenedVersionOneConstraintReturnsCorruptWithoutRecovery()
    {
        var captureId = await CreatePersistedSendingRowAsync();
        await RewriteSchemaSqlAsync(
            "table",
            "delivery_queue",
            "delivery_state INTEGER NOT NULL CHECK (delivery_state IN (0, 1, 2, 3, 4, 5))",
            "delivery_state INTEGER NOT NULL");
        await SetDeleteJournalModeAsync();
        var journalModeBefore = await ReadJournalModeAsync();

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Corrupt, result.Status);
        Assert.Equal(QueuedCaptureDeliveryState.Sending, await ReadDeliveryStateAsync(captureId));
        Assert.Equal(3L, await ReadAttemptCountAsync(captureId));
        Assert.Equal(journalModeBefore, await ReadJournalModeAsync());
    }

    [Fact]
    public async Task InitializeAsync_WithMissingRequiredIndexReturnsCorruptWithoutRecovery()
    {
        var captureId = await CreatePersistedSendingRowAsync();
        await ExecuteDatabaseCommandAsync("DROP INDEX ix_delivery_queue_eligible;");

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Corrupt, result.Status);
        Assert.Equal(QueuedCaptureDeliveryState.Sending, await ReadDeliveryStateAsync(captureId));
        Assert.Equal(3L, await ReadAttemptCountAsync(captureId));
    }

    [Fact]
    public async Task InitializeAsync_WithRecoveryChangingTriggerReturnsCorruptWithoutFiringTrigger()
    {
        var captureId = await CreatePersistedSendingRowAsync();
        await ExecuteDatabaseCommandAsync("""
            CREATE TRIGGER mutate_attempt_on_recovery
            AFTER UPDATE OF delivery_state ON delivery_queue
            WHEN OLD.delivery_state = 1 AND NEW.delivery_state = 0
            BEGIN
                UPDATE delivery_queue
                SET attempt_count = attempt_count + 1
                WHERE capture_id = NEW.capture_id;
            END;
            """);

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Corrupt, result.Status);
        Assert.Equal(QueuedCaptureDeliveryState.Sending, await ReadDeliveryStateAsync(captureId));
        Assert.Equal(3L, await ReadAttemptCountAsync(captureId));
    }

    [Fact]
    public async Task InitializeAsync_WithIndexDefinitionContentMismatchReturnsCorruptWithoutRecovery()
    {
        var captureId = await CreatePersistedSendingRowAsync();
        await ReplaceSchemaSqlAsync(
            "index",
            "ix_delivery_queue_eligible",
            "CREATE INDEX ix_delivery_queue_eligible ON delivery_queue (attempt_count)");

        var result = await CreateStore().InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.Corrupt, result.Status);
        Assert.Equal(QueuedCaptureDeliveryState.Sending, await ReadDeliveryStateAsync(captureId));
        Assert.Equal(3L, await ReadAttemptCountAsync(captureId));
    }

    [Fact]
    public async Task InitializeAsync_WithUnavailableParentReturnsStorageUnavailable()
    {
        Directory.CreateDirectory(_rootDirectory);
        var occupiedParentPath = Path.Combine(_rootDirectory, "occupied");
        await File.WriteAllTextAsync(occupiedParentPath, "not a directory");
        var store = new SqliteDeliveryQueueStore(Path.Combine(occupiedParentPath, "delivery-queue.db"));

        var result = await store.InitializeAsync(CancellationToken.None);

        Assert.Equal(DeliveryQueueInitializationStatus.StorageUnavailable, result.Status);
        Assert.Equal(0, result.RecoveredInterruptedSendingCount);
        Assert.DoesNotContain(_rootDirectory, result.Detail);
    }

    [Fact]
    public async Task InitializeAsync_WhenCancelledPropagatesCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => CreateStore().InitializeAsync(cancellation.Token));

        Assert.False(File.Exists(DatabasePath));
    }

    [Fact]
    public async Task AdmitAsync_WhenInitializationIsNotReadyDoesNotCreateOrAdmitQueueData()
    {
        await CreateFutureSchemaAsync();

        var result = await CreateStore().AdmitAsync(CreateItem("{\"gameId\":\"future-schema\"}"));

        Assert.Equal(DeliveryQueueAdmissionOutcome.StorageUnavailable, result.Outcome);
        Assert.Null(result.CaptureId);
        Assert.Equal("preserve-me", await ReadSentinelAsync());
        Assert.False(await TableExistsAsync("delivery_queue"));
    }

    [Fact]
    public async Task AdmitAsync_StoresThenDeduplicatesAnExactReplay()
    {
        var store = CreateStore();
        var item = CreateItem("{\"gameId\":\"game-1\"}");

        var stored = await store.AdmitAsync(item);
        var replay = await store.AdmitAsync(item);

        Assert.Equal(DeliveryQueueAdmissionOutcome.Stored, stored.Outcome);
        Assert.Equal(item.Envelope.CaptureId, stored.CaptureId);
        Assert.Equal(DeliveryQueueAdmissionOutcome.Duplicate, replay.Outcome);
        Assert.Equal(item.Envelope.CaptureId, replay.CaptureId);
    }

    [Fact]
    public async Task AdmitAsync_RejectsAConflictingReuseOfCaptureId()
    {
        var store = CreateStore();
        var original = CreateItem("{\"gameId\":\"game-1\"}");
        var conflict = CreateItem("{\"gameId\":\"game-2\"}", captureId: original.Envelope.CaptureId);

        await store.AdmitAsync(original);
        var result = await store.AdmitAsync(conflict);

        Assert.Equal(DeliveryQueueAdmissionOutcome.CaptureIdConflict, result.Outcome);
        Assert.Equal(original.Envelope.CaptureId, result.CaptureId);
    }

    [Fact]
    public async Task AdmitAsync_RejectsAHashMatchedNonObjectPayload()
    {
        var store = CreateStore();
        var result = await store.AdmitAsync(CreateItem("[]"));

        Assert.Equal(DeliveryQueueAdmissionOutcome.Invalid, result.Outcome);
        Assert.Null(result.CaptureId);
    }

    private SqliteDeliveryQueueStore CreateStore() =>
        new(DatabasePath);

    private string DatabasePath => Path.Combine(_rootDirectory, "delivery-queue.db");

    private string ConnectionString => new SqliteConnectionStringBuilder
    {
        DataSource = DatabasePath,
        Mode = SqliteOpenMode.ReadWriteCreate,
        Pooling = false,
    }.ToString();

    private async Task CreateFutureSchemaAsync()
    {
        Directory.CreateDirectory(_rootDirectory);
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE relay_schema (
                singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
                schema_version INTEGER NOT NULL CHECK (schema_version > 0)
            );
            INSERT INTO relay_schema (singleton, schema_version) VALUES (1, 2);
            CREATE TABLE future_data (value TEXT NOT NULL);
            INSERT INTO future_data (value) VALUES ('preserve-me');
            """;
        await command.ExecuteNonQueryAsync();
    }

    private async Task CreateFutureSchemaWithMetadataAsync()
    {
        Directory.CreateDirectory(_rootDirectory);
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE relay_schema (
                singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
                schema_version INTEGER NOT NULL CHECK (schema_version > 0),
                metadata TEXT NOT NULL
            );
            INSERT INTO relay_schema (singleton, schema_version, metadata)
            VALUES (1, 2, 'future-metadata');
            CREATE TABLE future_data (value TEXT NOT NULL);
            INSERT INTO future_data (value) VALUES ('preserve-me');
            """;
        await command.ExecuteNonQueryAsync();
    }

    private async Task SeedInterruptedAndAcknowledgedRowsAsync(Guid interruptedCaptureId, Guid acknowledgedCaptureId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE delivery_queue
            SET delivery_state = 1,
                attempt_count = 3,
                last_attempted_at_utc_ms = 1788794550123,
                last_attempt_outcome = 1,
                last_attempt_safe_code = 'receiver-unavailable',
                next_attempt_at_utc_ms = 1788794610456
            WHERE capture_id = $interruptedCaptureId;

            INSERT INTO delivery_attempts (
                capture_id, attempt_number, attempted_at_utc_ms, outcome, safe_code,
                retry_not_before_utc_ms
            ) VALUES (
                $interruptedCaptureId, 3, 1788794550123, 1, 'receiver-unavailable', 1788794610456
            );

            UPDATE delivery_queue
            SET delivery_state = 5,
                attempt_count = 2,
                last_attempted_at_utc_ms = 1788794000123,
                last_attempt_outcome = 4,
                last_attempt_safe_code = 'stored',
                next_attempt_at_utc_ms = NULL,
                acknowledged_at_utc_ms = 1788794000789,
                acknowledgment_status = 0
            WHERE capture_id = $acknowledgedCaptureId;

            INSERT INTO delivery_attempts (
                capture_id, attempt_number, attempted_at_utc_ms, outcome, safe_code,
                retry_not_before_utc_ms
            ) VALUES (
                $acknowledgedCaptureId, 2, 1788794000123, 4, 'stored', NULL
            );
            """;
        command.Parameters.AddWithValue("$interruptedCaptureId", interruptedCaptureId.ToString("N"));
        command.Parameters.AddWithValue("$acknowledgedCaptureId", acknowledgedCaptureId.ToString("N"));
        await command.ExecuteNonQueryAsync();
    }

    private async Task<Guid> CreatePersistedSendingRowAsync()
    {
        var store = CreateStore();
        await store.InitializeAsync(CancellationToken.None);
        var item = CreateItem("{\"gameId\":\"schema-validation\"}");
        await store.AdmitAsync(item);
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE delivery_queue
            SET delivery_state = 1,
                attempt_count = 3,
                last_attempted_at_utc_ms = 1788794550123,
                last_attempt_outcome = 1,
                last_attempt_safe_code = 'receiver-unavailable',
                next_attempt_at_utc_ms = 1788794610456
            WHERE capture_id = $captureId;
            """;
        command.Parameters.AddWithValue("$captureId", item.Envelope.CaptureId.ToString("N"));
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
        return item.Envelope.CaptureId;
    }

    private async Task RewriteSchemaSqlAsync(
        string objectType,
        string objectName,
        string oldValue,
        string newValue)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA writable_schema = ON;
            UPDATE sqlite_schema
            SET sql = replace(sql, $oldValue, $newValue)
            WHERE type = $objectType AND name = $objectName;
            PRAGMA writable_schema = OFF;
            PRAGMA schema_version = 999;
            """;
        command.Parameters.AddWithValue("$oldValue", oldValue);
        command.Parameters.AddWithValue("$newValue", newValue);
        command.Parameters.AddWithValue("$objectType", objectType);
        command.Parameters.AddWithValue("$objectName", objectName);
        await command.ExecuteNonQueryAsync();
    }

    private async Task ReplaceSchemaSqlAsync(string objectType, string objectName, string newSql)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA writable_schema = ON;
            UPDATE sqlite_schema
            SET sql = $newSql
            WHERE type = $objectType AND name = $objectName;
            PRAGMA writable_schema = OFF;
            PRAGMA schema_version = 999;
            """;
        command.Parameters.AddWithValue("$newSql", newSql);
        command.Parameters.AddWithValue("$objectType", objectType);
        command.Parameters.AddWithValue("$objectName", objectName);
        await command.ExecuteNonQueryAsync();
    }

    private async Task ExecuteDatabaseCommandAsync(string commandText)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        await command.ExecuteNonQueryAsync();
    }

    private async Task SetDeleteJournalModeAsync()
    {
        SqliteConnection.ClearAllPools();
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode = DELETE;";
        Assert.Equal("delete", (string)(await command.ExecuteScalarAsync())!);
    }

    private async Task SetDeliveryStateAsync(Guid captureId, QueuedCaptureDeliveryState state)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE delivery_queue SET delivery_state = $state WHERE capture_id = $captureId;";
        command.Parameters.AddWithValue("$state", (int)state);
        command.Parameters.AddWithValue("$captureId", captureId.ToString("N"));
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
    }

    private async Task<QueuedCaptureDeliveryState> ReadDeliveryStateAsync(Guid captureId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT delivery_state FROM delivery_queue WHERE capture_id = $captureId;";
        command.Parameters.AddWithValue("$captureId", captureId.ToString("N"));
        return (QueuedCaptureDeliveryState)Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private async Task<long> ReadAttemptCountAsync(Guid captureId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT attempt_count FROM delivery_queue WHERE capture_id = $captureId;";
        command.Parameters.AddWithValue("$captureId", captureId.ToString("N"));
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<object?[]> ReadQueueFieldsExceptStateAsync(Guid captureId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT capture_id, installation_id, protocol_version, sequence, captured_at_utc_ticks,
                   queued_at_utc_ticks, app_version, observation_kind, source_platform,
                   source_platform_key, game_id, local_player_puuid, local_player_game_name,
                   local_player_tag_line, local_player_puuid_key, envelope_server_id,
                   envelope_event_id, destination_profile_id, destination_server_id,
                   destination_event_id, payload_sha256, payload_json, payload_bytes,
                   attempt_count, last_attempted_at_utc_ms, last_attempt_outcome,
                   last_attempt_safe_code, next_attempt_at_utc_ms, acknowledged_at_utc_ms,
                   acknowledgment_status
            FROM delivery_queue
            WHERE capture_id = $captureId;
            """;
        command.Parameters.AddWithValue("$captureId", captureId.ToString("N"));
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return ReadCurrentRow(reader);
    }

    private async Task<object?[]> ReadAttemptRowsAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT capture_id, attempt_number, attempted_at_utc_ms, outcome, safe_code,
                   retry_not_before_utc_ms
            FROM delivery_attempts
            ORDER BY capture_id, attempt_number;
            """;
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<object?>();
        while (await reader.ReadAsync())
        {
            values.AddRange(ReadCurrentRow(reader));
        }

        return values.ToArray();
    }

    private async Task<long> ReadSchemaVersionAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT schema_version FROM relay_schema WHERE singleton = 1;";
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> ReadSentinelAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM future_data LIMIT 1;";
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> ReadSchemaMetadataAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT metadata FROM relay_schema WHERE singleton = 1;";
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> ReadJournalModeAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode;";
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private async Task<bool> TableExistsAsync(string tableName)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $tableName;";
        command.Parameters.AddWithValue("$tableName", tableName);
        return (long)(await command.ExecuteScalarAsync())! == 1;
    }

    private static object?[] ReadCurrentRow(SqliteDataReader reader)
    {
        var values = new object?[reader.FieldCount];
        for (var index = 0; index < reader.FieldCount; index++)
        {
            values[index] = reader.IsDBNull(index) ? null : reader.GetValue(index);
        }

        return values;
    }

    private static void AssertRowsEqual(object?[] expected, object?[] actual)
    {
        Assert.Equal(expected.Length, actual.Length);
        for (var index = 0; index < expected.Length; index++)
        {
            Assert.Equal(expected[index], actual[index]);
        }
    }

    private static DeliveryQueueItem CreateItem(string payloadJson, Guid? captureId = null)
    {
        var payloadHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payloadJson))).ToLowerInvariant();
        var envelope = new CaptureEnvelope(
            CaptureEnvelope.V1ProtocolVersion,
            captureId ?? Guid.NewGuid(),
            Guid.NewGuid(),
            "1",
            new DateTimeOffset(2026, 9, 7, 15, 22, 30, TimeSpan.Zero).AddTicks(1234567),
            "0.1.0",
            DeliveryObservationKind.Event,
            "vn2",
            "game-1",
            new DeliveryLocalPlayer("local-player-puuid", "Demo Player", "VN2"),
            new DeliveryContext("server-1", "event-1"),
            payloadHash,
            payloadJson);

        return new DeliveryQueueItem(
            envelope,
            new DeliveryDestinationBinding(Guid.NewGuid(), new DeliveryContext("server-1", "event-1")),
            QueuedCaptureDeliveryState.Pending,
            DateTimeOffset.UtcNow,
            0,
            null,
            null,
            null);
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootDirectory))
        {
            Directory.Delete(_rootDirectory, recursive: true);
        }
    }
}
