using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using players_lcu_client.Core.Delivery;

namespace players_lcu_client.Infrastructure.Storage;

/// <summary>
/// SQLite-backed, crash-safe admission point for immutable relay captures.
/// </summary>
/// <remarks>
/// This foundation intentionally implements only admission. Delivery claiming, attempt recording,
/// acknowledgement cleanup, and spool import are separate concerns. Every successful admission
/// stores the immutable envelope, destination binding, payload, and pending state in one SQLite
/// transaction before it is exposed to a future uploader.
/// </remarks>
public sealed class SqliteDeliveryQueueStore : IDeliveryQueueStore, IDeliveryStatusReader
{
    private const int CurrentSchemaVersion = 1;
    private const int MaximumPayloadBytes = 4 * 1024 * 1024;
    private const int MaximumRetainedCaptures = 1_000;
    private const long MaximumRetainedPayloadBytes = 256L * 1024 * 1024;
    private const int BusyTimeoutMilliseconds = 5_000;
    private const string RelaySchemaSql = """
        CREATE TABLE relay_schema (
            singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
            schema_version INTEGER NOT NULL CHECK (schema_version > 0)
        )
        """;
    private const string DeliveryQueueSchemaSql = """
        CREATE TABLE delivery_queue (
            capture_id TEXT NOT NULL PRIMARY KEY,
            installation_id TEXT NOT NULL,
            protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
            sequence TEXT NOT NULL,
            captured_at_utc_ticks INTEGER NOT NULL,
            queued_at_utc_ticks INTEGER NOT NULL,
            app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 64),
            observation_kind INTEGER NOT NULL CHECK (observation_kind IN (0, 1)),
            source_platform TEXT NULL CHECK (
                source_platform IS NULL OR length(source_platform) BETWEEN 1 AND 64
            ),
            source_platform_key TEXT NOT NULL,
            game_id TEXT NOT NULL CHECK (length(game_id) BETWEEN 1 AND 128),
            local_player_puuid TEXT NULL CHECK (
                local_player_puuid IS NULL OR length(local_player_puuid) BETWEEN 1 AND 256
            ),
            local_player_game_name TEXT NULL CHECK (
                local_player_game_name IS NULL OR length(local_player_game_name) BETWEEN 1 AND 100
            ),
            local_player_tag_line TEXT NULL CHECK (
                local_player_tag_line IS NULL OR length(local_player_tag_line) BETWEEN 1 AND 100
            ),
            local_player_puuid_key TEXT NOT NULL,
            envelope_server_id TEXT NULL,
            envelope_event_id TEXT NULL,
            destination_profile_id TEXT NOT NULL,
            destination_server_id TEXT NULL,
            destination_event_id TEXT NULL,
            payload_sha256 TEXT NOT NULL CHECK (
                length(payload_sha256) = 64 AND
                payload_sha256 NOT GLOB '*[^0123456789abcdef]*'
            ),
            payload_json TEXT NOT NULL CHECK (length(payload_json) >= 2),
            payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 4194304),
            delivery_state INTEGER NOT NULL CHECK (delivery_state IN (0, 1, 2, 3, 4, 5)),
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            last_attempted_at_utc_ms INTEGER NULL,
            last_attempt_outcome INTEGER NULL,
            last_attempt_safe_code TEXT NULL,
            next_attempt_at_utc_ms INTEGER NULL,
            acknowledged_at_utc_ms INTEGER NULL,
            acknowledgment_status INTEGER NULL,
            CHECK (
                length(sequence) BETWEEN 1 AND 19 AND
                substr(sequence, 1, 1) GLOB '[1-9]' AND
                sequence NOT GLOB '*[^0-9]*'
            ),
            CHECK (
                (envelope_server_id IS NULL AND envelope_event_id IS NULL) OR
                (length(envelope_server_id) BETWEEN 1 AND 128 AND
                 length(envelope_event_id) BETWEEN 1 AND 128)
            ),
            CHECK (
                (destination_server_id IS NULL AND destination_event_id IS NULL) OR
                (length(destination_server_id) BETWEEN 1 AND 128 AND
                 length(destination_event_id) BETWEEN 1 AND 128)
            ),
            UNIQUE (installation_id, sequence),
            UNIQUE (
                destination_profile_id,
                game_id,
                source_platform_key,
                local_player_puuid_key,
                payload_sha256
            )
        )
        """;
    private const string DeliveryAttemptsSchemaSql = """
        CREATE TABLE delivery_attempts (
            capture_id TEXT NOT NULL,
            attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
            attempted_at_utc_ms INTEGER NOT NULL,
            outcome INTEGER NOT NULL,
            safe_code TEXT NULL,
            retry_not_before_utc_ms INTEGER NULL,
            PRIMARY KEY (capture_id, attempt_number),
            FOREIGN KEY (capture_id) REFERENCES delivery_queue (capture_id) ON DELETE CASCADE
        )
        """;
    private const string EligibleIndexSchemaSql = """
        CREATE INDEX ix_delivery_queue_eligible
            ON delivery_queue (delivery_state, next_attempt_at_utc_ms, queued_at_utc_ticks)
        """;

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private readonly string _databasePath;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _initializationGate = new(1, 1);
    private DeliveryQueueInitialization? _readyInitialization;

    /// <summary>
    /// Creates the queue under the current user's local application-data directory.
    /// </summary>
    public SqliteDeliveryQueueStore()
        : this(GetDefaultDatabasePath())
    {
    }

    /// <summary>
    /// Creates the queue at a caller-supplied database path. This constructor is internal so
    /// production composition cannot accidentally route durable user data to a transient path.
    /// </summary>
    internal SqliteDeliveryQueueStore(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);

        _databasePath = Path.GetFullPath(databasePath);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true,
        }.ToString();
    }

    /// <inheritdoc />
    public async Task<DeliveryQueueInitialization> InitializeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var readyInitialization = Volatile.Read(ref _readyInitialization);
        if (readyInitialization is not null)
        {
            return readyInitialization;
        }

        await _initializationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            readyInitialization = Volatile.Read(ref _readyInitialization);
            if (readyInitialization is not null)
            {
                return readyInitialization;
            }

            var initialization = await InitializeCoreAsync(cancellationToken).ConfigureAwait(false);
            if (initialization.Status == DeliveryQueueInitializationStatus.Ready)
            {
                Volatile.Write(ref _readyInitialization, initialization);
            }

            return initialization;
        }
        finally
        {
            _initializationGate.Release();
        }
    }

    private async Task<DeliveryQueueInitialization> InitializeCoreAsync(CancellationToken cancellationToken)
    {
        try
        {
            EnsureParentDirectory();

            await using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
            await InspectDatabaseAsync(connection, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            await ConfigureOperationalConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
            var recoveredCount = await InitializeSchemaAndRecoverAsync(connection, cancellationToken).ConfigureAwait(false);

            return new DeliveryQueueInitialization(
                DeliveryQueueInitializationStatus.Ready,
                recoveredCount,
                "The local delivery queue is ready.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (UnsupportedQueueSchemaException)
        {
            return new DeliveryQueueInitialization(
                DeliveryQueueInitializationStatus.UnsupportedSchema,
                0,
                "The local delivery queue schema is not supported by this application version.");
        }
        catch (CorruptQueueException)
        {
            return new DeliveryQueueInitialization(
                DeliveryQueueInitializationStatus.Corrupt,
                0,
                "The local delivery queue is corrupt and was preserved for recovery.");
        }
        catch (SqliteException exception) when (IsCorruptSqliteException(exception))
        {
            return new DeliveryQueueInitialization(
                DeliveryQueueInitializationStatus.Corrupt,
                0,
                "The local delivery queue is corrupt and was preserved for recovery.");
        }
        catch (Exception exception) when (IsExpectedStorageException(exception))
        {
            return new DeliveryQueueInitialization(
                DeliveryQueueInitializationStatus.StorageUnavailable,
                0,
                "The local delivery queue could not be initialized.");
        }
    }

    /// <inheritdoc />
    public async Task<DeliveryQueueAdmission> AdmitAsync(
        DeliveryQueueItem item,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        cancellationToken.ThrowIfCancellationRequested();

        if (!TryValidateAdmission(item, out var payloadBytes, out var detail))
        {
            return new DeliveryQueueAdmission(DeliveryQueueAdmissionOutcome.Invalid, null, detail);
        }

        var initialization = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready)
        {
            return new DeliveryQueueAdmission(
                DeliveryQueueAdmissionOutcome.StorageUnavailable,
                null,
                initialization.Detail);
        }

        try
        {
            await using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
            await ConfigureOperationalConnectionAsync(connection, cancellationToken).ConfigureAwait(false);

            await BeginImmediateAsync(connection, cancellationToken).ConfigureAwait(false);
            var transactionOpen = true;

            try
            {
                var existingCapture = await FindCaptureByIdAsync(
                    connection,
                    item.Envelope.CaptureId,
                    cancellationToken).ConfigureAwait(false);
                if (existingCapture is not null)
                {
                    var isExactReplay = ExistingCaptureMatches(existingCapture, item);
                    await RollbackAsync(connection).ConfigureAwait(false);
                    transactionOpen = false;
                    return new DeliveryQueueAdmission(
                        isExactReplay
                            ? DeliveryQueueAdmissionOutcome.Duplicate
                            : DeliveryQueueAdmissionOutcome.CaptureIdConflict,
                        item.Envelope.CaptureId,
                        isExactReplay
                            ? "This immutable capture is already retained by the local queue."
                            : "The capture ID is already retained with different immutable content.");
                }

                var duplicateCaptureId = await FindNaturalDuplicateCaptureIdAsync(
                    connection,
                    item,
                    cancellationToken).ConfigureAwait(false);
                if (duplicateCaptureId is not null)
                {
                    await RollbackAsync(connection).ConfigureAwait(false);
                    transactionOpen = false;
                    return new DeliveryQueueAdmission(
                        DeliveryQueueAdmissionOutcome.Duplicate,
                        duplicateCaptureId,
                        "This immutable capture is already retained by the local queue.");
                }

                var (captureCount, retainedPayloadBytes) = await GetRetainedUsageAsync(
                    connection,
                    cancellationToken).ConfigureAwait(false);
                if (captureCount >= MaximumRetainedCaptures ||
                    retainedPayloadBytes > MaximumRetainedPayloadBytes - payloadBytes)
                {
                    await RollbackAsync(connection).ConfigureAwait(false);
                    transactionOpen = false;
                    return new DeliveryQueueAdmission(
                        DeliveryQueueAdmissionOutcome.CapacityReached,
                        null,
                        "The local delivery queue is full; existing captures were preserved.");
                }

                await InsertPendingCaptureAsync(connection, item, payloadBytes, cancellationToken).ConfigureAwait(false);
                await CommitAsync(connection, cancellationToken).ConfigureAwait(false);
                transactionOpen = false;

                return new DeliveryQueueAdmission(
                    DeliveryQueueAdmissionOutcome.Stored,
                    item.Envelope.CaptureId,
                    "The capture was stored in the local delivery queue.");
            }
            catch
            {
                if (transactionOpen)
                {
                    await RollbackAsync(connection).ConfigureAwait(false);
                }

                throw;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (IsExpectedStorageException(exception))
        {
            return new DeliveryQueueAdmission(
                DeliveryQueueAdmissionOutcome.StorageUnavailable,
                null,
                $"The local delivery queue is unavailable ({exception.GetType().Name}).");
        }
    }

    /// <inheritdoc />
    public async Task<DeliveryQueueLease?> ClaimNextAsync(
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var initialization = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready)
        {
            return null;
        }

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        await ConfigureOperationalConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        await BeginImmediateAsync(connection, cancellationToken).ConfigureAwait(false);
        var transactionOpen = true;

        try
        {
            var captureId = await FindEligibleCaptureIdAsync(connection, nowUtc, cancellationToken).ConfigureAwait(false);
            if (captureId is null)
            {
                await CommitAsync(connection, cancellationToken).ConfigureAwait(false);
                transactionOpen = false;
                return null;
            }

            await ExecuteNonQueryAsync(
                connection,
                """
                UPDATE delivery_queue
                SET delivery_state = $sending,
                    attempt_count = attempt_count + 1,
                    last_attempted_at_utc_ms = NULL,
                    last_attempt_outcome = NULL,
                    last_attempt_safe_code = NULL,
                    next_attempt_at_utc_ms = NULL
                WHERE capture_id = $captureId AND
                    (delivery_state = $pending OR
                     (delivery_state = $retryScheduled AND next_attempt_at_utc_ms <= $nowUtcMs));
                """,
                cancellationToken,
                ("$sending", (int)QueuedCaptureDeliveryState.Sending),
                ("$captureId", captureId.Value.ToString("N")),
                ("$pending", (int)QueuedCaptureDeliveryState.Pending),
                ("$retryScheduled", (int)QueuedCaptureDeliveryState.RetryScheduled),
                ("$nowUtcMs", nowUtc.ToUnixTimeMilliseconds())).ConfigureAwait(false);

            var item = await ReadQueueItemAsync(connection, captureId.Value, cancellationToken).ConfigureAwait(false)
                ?? throw new IOException("SQLite lost a claimed delivery capture.");
            if (item.State != QueuedCaptureDeliveryState.Sending)
            {
                throw new IOException("SQLite did not claim the expected delivery capture.");
            }

            await CommitAsync(connection, cancellationToken).ConfigureAwait(false);
            transactionOpen = false;
            return new DeliveryQueueLease(item, item.AttemptCount, nowUtc);
        }
        catch
        {
            if (transactionOpen)
            {
                await RollbackAsync(connection).ConfigureAwait(false);
            }

            throw;
        }
    }

    /// <inheritdoc />
    public async Task CompleteAttemptAsync(
        DeliveryQueueLease lease,
        DeliveryAttemptCompletion completion,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(lease);
        ArgumentNullException.ThrowIfNull(completion);
        cancellationToken.ThrowIfCancellationRequested();

        if (!TryValidateCompletion(lease, completion, out var nextState))
        {
            throw new ArgumentException("The delivery attempt completion is invalid.", nameof(completion));
        }

        var initialization = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready)
        {
            throw new IOException(initialization.Detail);
        }

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        await ConfigureOperationalConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        await BeginImmediateAsync(connection, cancellationToken).ConfigureAwait(false);
        var transactionOpen = true;

        try
        {
            await ExecuteNonQueryAsync(
                connection,
                """
                INSERT INTO delivery_attempts (
                    capture_id, attempt_number, attempted_at_utc_ms, outcome, safe_code, retry_not_before_utc_ms
                ) VALUES (
                    $captureId, $attemptNumber, $attemptedAtUtcMs, $outcome, $safeCode, $retryNotBeforeUtcMs
                );
                """,
                cancellationToken,
                ("$captureId", lease.Item.Envelope.CaptureId.ToString("N")),
                ("$attemptNumber", lease.AttemptNumber),
                ("$attemptedAtUtcMs", lease.AttemptedAtUtc.ToUnixTimeMilliseconds()),
                ("$outcome", (int)completion.Outcome),
                ("$safeCode", completion.SafeCode),
                ("$retryNotBeforeUtcMs", completion.RetryNotBeforeUtc?.ToUnixTimeMilliseconds())).ConfigureAwait(false);

            var rowsUpdated = await ExecuteNonQueryWithParametersAsync(
                connection,
                """
                UPDATE delivery_queue
                SET delivery_state = $deliveryState,
                    last_attempted_at_utc_ms = $attemptedAtUtcMs,
                    last_attempt_outcome = $outcome,
                    last_attempt_safe_code = $safeCode,
                    next_attempt_at_utc_ms = $retryNotBeforeUtcMs,
                    acknowledged_at_utc_ms = $acknowledgedAtUtcMs,
                    acknowledgment_status = $acknowledgmentStatus
                WHERE capture_id = $captureId AND delivery_state = $sending AND attempt_count = $attemptNumber;
                """,
                cancellationToken,
                ("$deliveryState", (int)nextState),
                ("$attemptedAtUtcMs", lease.AttemptedAtUtc.ToUnixTimeMilliseconds()),
                ("$outcome", (int)completion.Outcome),
                ("$safeCode", completion.SafeCode),
                ("$retryNotBeforeUtcMs", completion.RetryNotBeforeUtc?.ToUnixTimeMilliseconds()),
                ("$acknowledgedAtUtcMs", completion.Acknowledgment?.ReceivedAtUtc.ToUnixTimeMilliseconds()),
                ("$acknowledgmentStatus", completion.Acknowledgment is null ? null : (int)completion.Acknowledgment.Status),
                ("$captureId", lease.Item.Envelope.CaptureId.ToString("N")),
                ("$sending", (int)QueuedCaptureDeliveryState.Sending),
                ("$attemptNumber", lease.AttemptNumber)).ConfigureAwait(false);
            if (rowsUpdated != 1)
            {
                throw new InvalidOperationException("The delivery lease is no longer active.");
            }

            await CommitAsync(connection, cancellationToken).ConfigureAwait(false);
            transactionOpen = false;
        }
        catch
        {
            if (transactionOpen)
            {
                await RollbackAsync(connection).ConfigureAwait(false);
            }

            throw;
        }
    }

    public async Task<IReadOnlyList<DeliveryQueueItem>> ReadRecentAsync(int limit, CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        var initialization = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready) return [];
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        var ids = new List<Guid>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT capture_id FROM delivery_queue ORDER BY queued_at_utc_ticks DESC LIMIT $limit;";
            AddParameter(command, "$limit", limit);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) ids.Add(Guid.ParseExact(reader.GetString(0), "N"));
        }
        var items = new List<DeliveryQueueItem>(ids.Count);
        foreach (var id in ids)
        {
            var item = await ReadQueueItemAsync(connection, id, cancellationToken).ConfigureAwait(false);
            if (item is not null) items.Add(item);
        }
        return items;
    }

    public async Task<IReadOnlyList<DeliveryStatusItem>> ReadDeliveryStatusAsync(int limit, CancellationToken cancellationToken)
    {
        if (limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        var initialization = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready)
            throw new InvalidOperationException("Delivery storage unavailable.");
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ConfigureInspectionConnectionAsync(connection, cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT game_id, capture_id, delivery_state, attempt_count, last_attempt_safe_code,
                   next_attempt_at_utc_ms, acknowledged_at_utc_ms
            FROM delivery_queue ORDER BY queued_at_utc_ticks DESC LIMIT $limit;
            """;
        AddParameter(command, "$limit", limit);
        var items = new List<DeliveryStatusItem>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            items.Add(new DeliveryStatusItem(reader.GetString(0), Guid.ParseExact(reader.GetString(1), "N").ToString("D"),
                (QueuedCaptureDeliveryState)reader.GetInt32(2), reader.GetInt64(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                ReadNullableUtcMilliseconds(reader, 5), ReadNullableUtcMilliseconds(reader, 6)));
        return items;
    }

    private static bool TryValidateCompletion(
        DeliveryQueueLease lease,
        DeliveryAttemptCompletion completion,
        out QueuedCaptureDeliveryState nextState)
    {
        nextState = default;
        if (lease.Item.State != QueuedCaptureDeliveryState.Sending ||
            lease.Item.Envelope.CaptureId == Guid.Empty ||
            lease.AttemptNumber < 1 ||
            lease.AttemptNumber != lease.Item.AttemptCount ||
            !HasOptionalStringLength(completion.SafeCode, 1, 128))
        {
            return false;
        }

        switch (completion.Outcome)
        {
            case DeliveryAttemptOutcome.Acknowledged:
                if (completion.Acknowledgment is null ||
                    completion.Acknowledgment.CaptureId != lease.Item.Envelope.CaptureId ||
                    completion.Acknowledgment.Status is not DeliveryAcknowledgmentStatus.Stored and not DeliveryAcknowledgmentStatus.Duplicate ||
                    completion.RetryNotBeforeUtc is not null)
                {
                    return false;
                }

                nextState = QueuedCaptureDeliveryState.Acknowledged;
                return true;

            case DeliveryAttemptOutcome.RetryableFailure:
            case DeliveryAttemptOutcome.NoAcknowledgment:
                if (completion.Acknowledgment is not null ||
                    string.IsNullOrWhiteSpace(completion.SafeCode) ||
                    completion.RetryNotBeforeUtc is null ||
                    completion.RetryNotBeforeUtc <= lease.AttemptedAtUtc)
                {
                    return false;
                }

                nextState = QueuedCaptureDeliveryState.RetryScheduled;
                return true;

            case DeliveryAttemptOutcome.Blocked:
                if (completion.Acknowledgment is not null ||
                    string.IsNullOrWhiteSpace(completion.SafeCode) ||
                    completion.RetryNotBeforeUtc is not null)
                {
                    return false;
                }

                nextState = QueuedCaptureDeliveryState.Blocked;
                return true;

            case DeliveryAttemptOutcome.Rejected:
                if (completion.Acknowledgment is not null ||
                    string.IsNullOrWhiteSpace(completion.SafeCode) ||
                    completion.RetryNotBeforeUtc is not null)
                {
                    return false;
                }

                nextState = QueuedCaptureDeliveryState.Rejected;
                return true;

            default:
                return false;
        }
    }

    private static async Task<Guid?> FindEligibleCaptureIdAsync(
        SqliteConnection connection,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT capture_id
            FROM delivery_queue
            WHERE delivery_state = $pending OR
                (delivery_state = $retryScheduled AND next_attempt_at_utc_ms <= $nowUtcMs)
            ORDER BY queued_at_utc_ticks ASC
            LIMIT 1;
            """;
        AddParameter(command, "$pending", (int)QueuedCaptureDeliveryState.Pending);
        AddParameter(command, "$retryScheduled", (int)QueuedCaptureDeliveryState.RetryScheduled);
        AddParameter(command, "$nowUtcMs", nowUtc.ToUnixTimeMilliseconds());
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return value is string captureId && Guid.TryParseExact(captureId, "N", out var parsed)
            ? parsed
            : null;
    }

    private static async Task<DeliveryQueueItem?> ReadQueueItemAsync(
        SqliteConnection connection,
        Guid captureId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT capture_id, installation_id, protocol_version, sequence, captured_at_utc_ticks,
                   queued_at_utc_ticks, app_version, observation_kind, source_platform, game_id,
                   local_player_puuid, local_player_game_name, local_player_tag_line,
                   envelope_server_id, envelope_event_id, destination_profile_id,
                   destination_server_id, destination_event_id, payload_sha256, payload_json,
                   delivery_state, attempt_count, last_attempted_at_utc_ms, last_attempt_outcome,
                   last_attempt_safe_code, next_attempt_at_utc_ms, acknowledged_at_utc_ms,
                   acknowledgment_status
            FROM delivery_queue
            WHERE capture_id = $captureId
            LIMIT 1;
            """;
        AddParameter(command, "$captureId", captureId.ToString("N"));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        var envelopeContext = ReadContext(reader, 13, 14);
        var destinationContext = ReadContext(reader, 16, 17);
        var envelope = new CaptureEnvelope(
            reader.GetInt32(2),
            Guid.ParseExact(reader.GetString(0), "N"),
            Guid.ParseExact(reader.GetString(1), "N"),
            reader.GetString(3),
            FromUtcTicks(reader.GetInt64(4)),
            reader.GetString(6),
            (DeliveryObservationKind)reader.GetInt32(7),
            GetNullableString(reader, 8),
            reader.GetString(9),
            new DeliveryLocalPlayer(GetNullableString(reader, 10), GetNullableString(reader, 11), GetNullableString(reader, 12)),
            envelopeContext,
            reader.GetString(18),
            reader.GetString(19));
        var state = (QueuedCaptureDeliveryState)reader.GetInt32(20);
        var attemptCount = reader.GetInt64(21);
        var attemptedAtUtc = ReadNullableUtcMilliseconds(reader, 22);
        var outcome = reader.IsDBNull(23) ? (DeliveryAttemptOutcome?)null : (DeliveryAttemptOutcome)reader.GetInt32(23);
        var retryNotBeforeUtc = ReadNullableUtcMilliseconds(reader, 25);
        var lastAttempt = attemptedAtUtc is { } attempted && outcome is { } attemptOutcome
            ? new DeliveryAttempt(attemptCount, attempted, attemptOutcome, GetNullableString(reader, 24), retryNotBeforeUtc)
            : null;
        var acknowledgedAtUtc = ReadNullableUtcMilliseconds(reader, 26);
        var acknowledgment = acknowledgedAtUtc is { } acknowledgedAt && !reader.IsDBNull(27)
            ? new DeliveryAcknowledgment(envelope.CaptureId, (DeliveryAcknowledgmentStatus)reader.GetInt32(27), acknowledgedAt)
            : null;

        return new DeliveryQueueItem(
            envelope,
            new DeliveryDestinationBinding(Guid.ParseExact(reader.GetString(15), "N"), destinationContext),
            state,
            FromUtcTicks(reader.GetInt64(5)),
            attemptCount,
            lastAttempt,
            retryNotBeforeUtc,
            acknowledgment);
    }

    private static DeliveryContext? ReadContext(SqliteDataReader reader, int serverIdOrdinal, int eventIdOrdinal)
    {
        var serverId = GetNullableString(reader, serverIdOrdinal);
        var eventId = GetNullableString(reader, eventIdOrdinal);
        if (serverId is null && eventId is null)
        {
            return null;
        }

        if (serverId is null || eventId is null)
        {
            throw new IOException("SQLite retained an incomplete delivery context.");
        }

        return new DeliveryContext(serverId, eventId);
    }

    private static DateTimeOffset FromUtcTicks(long ticks) =>
        new(new DateTime(ticks, DateTimeKind.Utc));

    private static DateTimeOffset? ReadNullableUtcMilliseconds(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(ordinal));

    private static bool TryValidateAdmission(
        DeliveryQueueItem item,
        out int payloadBytes,
        out string detail)
    {
        payloadBytes = 0;
        detail = string.Empty;

        var envelope = item.Envelope;
        var destination = item.Destination;
        if (envelope is null || destination is null || envelope.LocalPlayer is null)
        {
            detail = "The capture envelope or destination binding is missing.";
            return false;
        }

        if (item.State != QueuedCaptureDeliveryState.Pending ||
            item.AttemptCount != 0 ||
            item.LastAttempt is not null ||
            item.NextAttemptAtUtc is not null ||
            item.Acknowledgment is not null)
        {
            detail = "New captures must begin in the pending delivery state without attempt or receipt data.";
            return false;
        }

        if (envelope.ProtocolVersion != CaptureEnvelope.V1ProtocolVersion ||
            envelope.CaptureId == Guid.Empty ||
            envelope.InstallationId == Guid.Empty ||
            destination.DestinationProfileId == Guid.Empty)
        {
            detail = "The capture identifiers or protocol version are invalid.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(envelope.Sequence) ||
            !IsCanonicalSequence(envelope.Sequence) ||
            string.IsNullOrWhiteSpace(envelope.AppVersion) ||
            string.IsNullOrWhiteSpace(envelope.GameId) ||
            string.IsNullOrEmpty(envelope.PayloadJson))
        {
            detail = "The capture envelope is missing a required immutable value.";
            return false;
        }

        if (!HasStringLength(envelope.AppVersion, 1, 64) ||
            !HasStringLength(envelope.GameId, 1, 128) ||
            !HasOptionalStringLength(envelope.SourcePlatform, 1, 64) ||
            !HasOptionalStringLength(envelope.LocalPlayer.Puuid, 1, 256) ||
            !HasOptionalStringLength(envelope.LocalPlayer.GameName, 1, 100) ||
            !HasOptionalStringLength(envelope.LocalPlayer.TagLine, 1, 100))
        {
            detail = "The capture envelope exceeds a v1 string limit.";
            return false;
        }

        if (envelope.ObservationKind is not DeliveryObservationKind.Event and not DeliveryObservationKind.Recovery ||
            !HasValidContext(envelope.Context) ||
            !HasValidContext(destination.VerifiedContext))
        {
            detail = "The capture observation or destination context is invalid.";
            return false;
        }

        try
        {
            payloadBytes = StrictUtf8.GetByteCount(envelope.PayloadJson);
        }
        catch (EncoderFallbackException)
        {
            detail = "The capture payload is not valid UTF-8 text.";
            return false;
        }

        if (payloadBytes <= 0 || payloadBytes > MaximumPayloadBytes)
        {
            detail = "The capture payload exceeds the 4 MiB local queue limit.";
            return false;
        }

        if (!IsJsonObject(envelope.PayloadJson))
        {
            detail = "The capture payload must be a valid JSON object.";
            return false;
        }

        if (!HasLowercaseSha256(envelope.PayloadSha256) ||
            !PayloadHashMatches(envelope.PayloadJson, payloadBytes, envelope.PayloadSha256))
        {
            detail = "The capture payload hash does not match its original UTF-8 text.";
            return false;
        }

        return true;
    }

    private static bool HasValidContext(DeliveryContext? context) =>
        context is null ||
        (HasStringLength(context.ServerId, 1, 128) && HasStringLength(context.EventId, 1, 128));

    private static bool IsCanonicalSequence(string value)
    {
        if (value.Length is < 1 or > 19 || value[0] is < '1' or > '9')
        {
            return false;
        }

        for (var index = 1; index < value.Length; index++)
        {
            var character = value[index];
            if (character is < '0' or > '9')
            {
                return false;
            }
        }

        return true;
    }

    private static bool HasStringLength(string? value, int minimum, int maximum) =>
        value is not null && value.Length >= minimum && value.Length <= maximum;

    private static bool HasOptionalStringLength(string? value, int minimum, int maximum) =>
        value is null || HasStringLength(value, minimum, maximum);

    private static bool IsJsonObject(string value)
    {
        try
        {
            using var document = JsonDocument.Parse(value, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 128,
            });
            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool HasLowercaseSha256(string? value)
    {
        if (value is null || value.Length != 64)
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))
            {
                return false;
            }
        }

        return true;
    }

    private static bool PayloadHashMatches(string payloadJson, int payloadBytes, string expectedHash)
    {
        var rented = ArrayPool<byte>.Shared.Rent(payloadBytes);

        try
        {
            var bytesWritten = StrictUtf8.GetBytes(payloadJson.AsSpan(), rented.AsSpan(0, payloadBytes));
            var actualHash = Convert.ToHexString(SHA256.HashData(rented.AsSpan(0, bytesWritten))).ToLowerInvariant();
            return string.Equals(actualHash, expectedHash, StringComparison.Ordinal);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(rented.AsSpan(0, payloadBytes));
            ArrayPool<byte>.Shared.Return(rented, clearArray: false);
        }
    }

    private void EnsureParentDirectory()
    {
        var parentDirectory = Path.GetDirectoryName(_databasePath);
        if (string.IsNullOrWhiteSpace(parentDirectory))
        {
            throw new InvalidOperationException("The delivery queue database path has no parent directory.");
        }

        Directory.CreateDirectory(parentDirectory);
    }

    private static async Task ConfigureInspectionConnectionAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await ExecuteNonQueryAsync(connection, "PRAGMA foreign_keys = ON;", cancellationToken).ConfigureAwait(false);
        await ExecuteNonQueryAsync(connection, $"PRAGMA busy_timeout = {BusyTimeoutMilliseconds};", cancellationToken).ConfigureAwait(false);
    }

    private static async Task ConfigureOperationalConnectionAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var journalMode = await ExecuteScalarAsync(connection, "PRAGMA journal_mode = WAL;", cancellationToken).ConfigureAwait(false);
        if (!string.Equals(journalMode as string, "wal", StringComparison.OrdinalIgnoreCase))
        {
            throw new IOException("SQLite could not enable write-ahead logging for the delivery queue.");
        }

        await ExecuteNonQueryAsync(connection, "PRAGMA synchronous = FULL;", cancellationToken).ConfigureAwait(false);
    }

    private static async Task InspectDatabaseAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await ValidateDatabaseIntegrityAsync(connection, cancellationToken).ConfigureAwait(false);
        if (!await TableExistsAsync(connection, "relay_schema", cancellationToken).ConfigureAwait(false))
        {
            if (await CountUserTablesAsync(connection, cancellationToken).ConfigureAwait(false) != 0)
            {
                throw new CorruptQueueException();
            }

            return;
        }

        var schemaVersion = await ReadRecognizableSchemaVersionAsync(connection, cancellationToken).ConfigureAwait(false);
        if (schemaVersion != CurrentSchemaVersion)
        {
            throw new UnsupportedQueueSchemaException();
        }

        await ValidateVersionOneSchemaAsync(connection, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<int> InitializeSchemaAndRecoverAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await BeginImmediateAsync(connection, cancellationToken).ConfigureAwait(false);
        var transactionOpen = true;

        try
        {
            await ValidateDatabaseIntegrityAsync(connection, cancellationToken).ConfigureAwait(false);
            var schemaTableExists = await TableExistsAsync(connection, "relay_schema", cancellationToken).ConfigureAwait(false);

            if (!schemaTableExists)
            {
                var userTableCount = await CountUserTablesAsync(connection, cancellationToken).ConfigureAwait(false);
                if (userTableCount != 0)
                {
                    throw new CorruptQueueException();
                }

                await ExecuteNonQueryAsync(connection, RelaySchemaSql, cancellationToken).ConfigureAwait(false);
                await ApplyVersionOneSchemaAsync(connection, cancellationToken).ConfigureAwait(false);
                await ExecuteNonQueryAsync(
                    connection,
                    "INSERT INTO relay_schema (singleton, schema_version) VALUES (1, $schemaVersion);",
                    cancellationToken,
                    ("$schemaVersion", CurrentSchemaVersion)).ConfigureAwait(false);
            }
            else
            {
                var schemaVersion = await ReadRecognizableSchemaVersionAsync(connection, cancellationToken).ConfigureAwait(false);
                if (schemaVersion != CurrentSchemaVersion)
                {
                    throw new UnsupportedQueueSchemaException();
                }
            }

            await ValidateVersionOneSchemaAsync(connection, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            var recoveredCount = await ExecuteNonQueryWithRowCountAsync(
                connection,
                "UPDATE delivery_queue SET delivery_state = 0 WHERE delivery_state = 1;",
                cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            await CommitAsync(connection, cancellationToken).ConfigureAwait(false);
            transactionOpen = false;
            return recoveredCount;
        }
        catch
        {
            if (transactionOpen)
            {
                await RollbackAsync(connection).ConfigureAwait(false);
            }

            throw;
        }
    }

    private static async Task<long> ReadRecognizableSchemaVersionAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var relaySchemaColumns = await ReadTableColumnsAsync(
            connection,
            "relay_schema",
            cancellationToken).ConfigureAwait(false);
        if (!relaySchemaColumns.Contains("singleton") || !relaySchemaColumns.Contains("schema_version"))
        {
            throw new CorruptQueueException();
        }

        var existingVersion = await ExecuteScalarAsync(
            connection,
            "SELECT schema_version FROM relay_schema WHERE singleton = 1;",
            cancellationToken).ConfigureAwait(false);
        return existingVersion is long schemaVersion ? schemaVersion : throw new CorruptQueueException();
    }

    private static async Task ValidateDatabaseIntegrityAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA integrity_check;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ||
            !string.Equals(reader.GetString(0), "ok", StringComparison.Ordinal))
        {
            throw new CorruptQueueException();
        }

        if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task<long> CountUserTablesAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var value = await ExecuteScalarAsync(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
            cancellationToken).ConfigureAwait(false);
        return value is long count ? count : throw new CorruptQueueException();
    }

    private static async Task<bool> TableExistsAsync(
        SqliteConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $tableName;";
        AddParameter(command, "$tableName", tableName);
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return value is long count && count == 1;
    }

    private static async Task ValidateVersionOneSchemaAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await ValidateSchemaObjectAsync(
            connection,
            "table",
            "relay_schema",
            "relay_schema",
            RelaySchemaSql,
            cancellationToken).ConfigureAwait(false);
        await ValidateSchemaObjectAsync(
            connection,
            "table",
            "delivery_queue",
            "delivery_queue",
            DeliveryQueueSchemaSql,
            cancellationToken).ConfigureAwait(false);
        await ValidateSchemaObjectAsync(
            connection,
            "table",
            "delivery_attempts",
            "delivery_attempts",
            DeliveryAttemptsSchemaSql,
            cancellationToken).ConfigureAwait(false);
        await ValidateSchemaObjectAsync(
            connection,
            "index",
            "ix_delivery_queue_eligible",
            "delivery_queue",
            EligibleIndexSchemaSql,
            cancellationToken).ConfigureAwait(false);
        await ValidateUserSchemaObjectSetAsync(connection, cancellationToken).ConfigureAwait(false);

        await ValidateTableColumnsAsync(
            connection,
            "relay_schema",
            ["singleton", "schema_version"],
            cancellationToken).ConfigureAwait(false);
        await ValidateTableColumnsAsync(
            connection,
            "delivery_queue",
            [
                "capture_id", "installation_id", "protocol_version", "sequence",
                "captured_at_utc_ticks", "queued_at_utc_ticks", "app_version", "observation_kind",
                "source_platform", "source_platform_key", "game_id", "local_player_puuid",
                "local_player_game_name", "local_player_tag_line", "local_player_puuid_key",
                "envelope_server_id", "envelope_event_id", "destination_profile_id",
                "destination_server_id", "destination_event_id", "payload_sha256", "payload_json",
                "payload_bytes", "delivery_state", "attempt_count", "last_attempted_at_utc_ms",
                "last_attempt_outcome", "last_attempt_safe_code", "next_attempt_at_utc_ms",
                "acknowledged_at_utc_ms", "acknowledgment_status",
            ],
            cancellationToken).ConfigureAwait(false);
        await ValidateTableColumnsAsync(
            connection,
            "delivery_attempts",
            [
                "capture_id", "attempt_number", "attempted_at_utc_ms", "outcome", "safe_code",
                "retry_not_before_utc_ms",
            ],
            cancellationToken).ConfigureAwait(false);
        await ValidateIndexColumnsAsync(
            connection,
            "ix_delivery_queue_eligible",
            ["delivery_state", "next_attempt_at_utc_ms", "queued_at_utc_ticks"],
            cancellationToken).ConfigureAwait(false);
        await ValidateDeliveryAttemptsForeignKeyAsync(connection, cancellationToken).ConfigureAwait(false);

        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_key_check;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task ValidateSchemaObjectAsync(
        SqliteConnection connection,
        string objectType,
        string objectName,
        string tableName,
        string expectedSql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT sql
            FROM sqlite_schema
            WHERE type = $objectType AND name = $objectName AND tbl_name = $tableName;
            """;
        AddParameter(command, "$objectType", objectType);
        AddParameter(command, "$objectName", objectName);
        AddParameter(command, "$tableName", tableName);
        var actualSql = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        if (actualSql is not string sql ||
            !string.Equals(NormalizeSchemaSql(sql), NormalizeSchemaSql(expectedSql), StringComparison.Ordinal))
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task ValidateUserSchemaObjectSetAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var expectedObjects = new HashSet<string>(StringComparer.Ordinal)
        {
            "table\0relay_schema\0relay_schema",
            "table\0delivery_queue\0delivery_queue",
            "table\0delivery_attempts\0delivery_attempts",
            "index\0ix_delivery_queue_eligible\0delivery_queue",
        };
        var actualObjects = new HashSet<string>(StringComparer.Ordinal);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT type, name, tbl_name
            FROM sqlite_schema
            WHERE name NOT LIKE 'sqlite_%';
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            actualObjects.Add($"{reader.GetString(0)}\0{reader.GetString(1)}\0{reader.GetString(2)}");
        }

        if (!actualObjects.SetEquals(expectedObjects))
        {
            throw new CorruptQueueException();
        }
    }

    private static string NormalizeSchemaSql(string sql)
    {
        var normalized = new StringBuilder(sql.Length);
        var whitespacePending = false;
        foreach (var character in sql.AsSpan().Trim().TrimEnd(';'))
        {
            if (char.IsWhiteSpace(character))
            {
                whitespacePending = normalized.Length > 0;
                continue;
            }

            if (whitespacePending)
            {
                normalized.Append(' ');
                whitespacePending = false;
            }

            normalized.Append(character);
        }

        return normalized.ToString();
    }

    private static async Task ValidateIndexColumnsAsync(
        SqliteConnection connection,
        string indexName,
        IReadOnlyList<string> expectedColumns,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA index_info(\"{indexName}\");";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var index = 0;
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (index >= expectedColumns.Count ||
                reader.GetInt32(0) != index ||
                !string.Equals(reader.GetString(2), expectedColumns[index], StringComparison.Ordinal))
            {
                throw new CorruptQueueException();
            }

            index++;
        }

        if (index != expectedColumns.Count)
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task ValidateDeliveryAttemptsForeignKeyAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_key_list(\"delivery_attempts\");";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ||
            reader.GetInt32(0) != 0 ||
            reader.GetInt32(1) != 0 ||
            !string.Equals(reader.GetString(2), "delivery_queue", StringComparison.Ordinal) ||
            !string.Equals(reader.GetString(3), "capture_id", StringComparison.Ordinal) ||
            !string.Equals(reader.GetString(4), "capture_id", StringComparison.Ordinal) ||
            !string.Equals(reader.GetString(5), "NO ACTION", StringComparison.Ordinal) ||
            !string.Equals(reader.GetString(6), "CASCADE", StringComparison.Ordinal) ||
            !string.Equals(reader.GetString(7), "NONE", StringComparison.Ordinal) ||
            await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task ValidateTableColumnsAsync(
        SqliteConnection connection,
        string tableName,
        IEnumerable<string> expectedColumns,
        CancellationToken cancellationToken)
    {
        var actualColumns = await ReadTableColumnsAsync(connection, tableName, cancellationToken).ConfigureAwait(false);
        if (!actualColumns.SetEquals(expectedColumns))
        {
            throw new CorruptQueueException();
        }
    }

    private static async Task<HashSet<string>> ReadTableColumnsAsync(
        SqliteConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info(\"{tableName}\");";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var actualColumns = new HashSet<string>(StringComparer.Ordinal);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            actualColumns.Add(reader.GetString(1));
        }

        return actualColumns;
    }

    private static async Task ApplyVersionOneSchemaAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await ExecuteNonQueryAsync(connection, DeliveryQueueSchemaSql, cancellationToken).ConfigureAwait(false);
        await ExecuteNonQueryAsync(connection, DeliveryAttemptsSchemaSql, cancellationToken).ConfigureAwait(false);
        await ExecuteNonQueryAsync(connection, EligibleIndexSchemaSql, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<RetainedCapture?> FindCaptureByIdAsync(
        SqliteConnection connection,
        Guid captureId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT installation_id, protocol_version, sequence, captured_at_utc_ticks,
                   app_version, observation_kind, source_platform, game_id,
                   local_player_puuid, local_player_game_name, local_player_tag_line,
                   envelope_server_id, envelope_event_id, destination_profile_id,
                   destination_server_id, destination_event_id, payload_sha256, payload_json
            FROM delivery_queue
            WHERE capture_id = $captureId
            LIMIT 1;
            """;
        AddParameter(command, "$captureId", captureId.ToString("N"));

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        return new RetainedCapture(
            reader.GetString(0),
            reader.GetInt32(1),
            reader.GetString(2),
            reader.GetInt64(3),
            reader.GetString(4),
            reader.GetInt32(5),
            GetNullableString(reader, 6),
            reader.GetString(7),
            GetNullableString(reader, 8),
            GetNullableString(reader, 9),
            GetNullableString(reader, 10),
            GetNullableString(reader, 11),
            GetNullableString(reader, 12),
            reader.GetString(13),
            GetNullableString(reader, 14),
            GetNullableString(reader, 15),
            reader.GetString(16),
            reader.GetString(17));
    }

    private static bool ExistingCaptureMatches(RetainedCapture existing, DeliveryQueueItem item)
    {
        var envelope = item.Envelope;
        var destination = item.Destination;

        return string.Equals(existing.InstallationId, envelope.InstallationId.ToString("N"), StringComparison.Ordinal) &&
               existing.ProtocolVersion == envelope.ProtocolVersion &&
               string.Equals(existing.Sequence, envelope.Sequence, StringComparison.Ordinal) &&
               existing.CapturedAtUtcTicks == envelope.CapturedAtUtc.UtcDateTime.Ticks &&
               string.Equals(existing.AppVersion, envelope.AppVersion, StringComparison.Ordinal) &&
               existing.ObservationKind == (int)envelope.ObservationKind &&
               NullableStringEquals(existing.SourcePlatform, envelope.SourcePlatform) &&
               string.Equals(existing.GameId, envelope.GameId, StringComparison.Ordinal) &&
               NullableStringEquals(existing.LocalPlayerPuuid, envelope.LocalPlayer.Puuid) &&
               NullableStringEquals(existing.LocalPlayerGameName, envelope.LocalPlayer.GameName) &&
               NullableStringEquals(existing.LocalPlayerTagLine, envelope.LocalPlayer.TagLine) &&
               NullableStringEquals(existing.EnvelopeServerId, envelope.Context?.ServerId) &&
               NullableStringEquals(existing.EnvelopeEventId, envelope.Context?.EventId) &&
               string.Equals(existing.DestinationProfileId, destination.DestinationProfileId.ToString("N"), StringComparison.Ordinal) &&
               NullableStringEquals(existing.DestinationServerId, destination.VerifiedContext?.ServerId) &&
               NullableStringEquals(existing.DestinationEventId, destination.VerifiedContext?.EventId) &&
               string.Equals(existing.PayloadSha256, envelope.PayloadSha256, StringComparison.Ordinal) &&
               string.Equals(existing.PayloadJson, envelope.PayloadJson, StringComparison.Ordinal);
    }

    private static bool NullableStringEquals(string? left, string? right) =>
        string.Equals(left, right, StringComparison.Ordinal);

    private sealed record RetainedCapture(
        string InstallationId,
        int ProtocolVersion,
        string Sequence,
        long CapturedAtUtcTicks,
        string AppVersion,
        int ObservationKind,
        string? SourcePlatform,
        string GameId,
        string? LocalPlayerPuuid,
        string? LocalPlayerGameName,
        string? LocalPlayerTagLine,
        string? EnvelopeServerId,
        string? EnvelopeEventId,
        string DestinationProfileId,
        string? DestinationServerId,
        string? DestinationEventId,
        string PayloadSha256,
        string PayloadJson);

    private static string? GetNullableString(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static async Task<Guid?> FindNaturalDuplicateCaptureIdAsync(
        SqliteConnection connection,
        DeliveryQueueItem item,
        CancellationToken cancellationToken)
    {
        var envelope = item.Envelope;
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT capture_id
            FROM delivery_queue
            WHERE destination_profile_id = $destinationProfileId AND
                  game_id = $gameId AND
                  source_platform_key = $sourcePlatformKey AND
                  local_player_puuid_key = $localPlayerPuuidKey AND
                  payload_sha256 = $payloadSha256
            LIMIT 1;
            """;
        AddParameter(command, "$destinationProfileId", item.Destination.DestinationProfileId.ToString("N"));
        AddParameter(command, "$gameId", envelope.GameId);
        AddParameter(command, "$sourcePlatformKey", NormalizeDeduplicationComponent(envelope.SourcePlatform));
        AddParameter(command, "$localPlayerPuuidKey", NormalizeDeduplicationComponent(envelope.LocalPlayer.Puuid));
        AddParameter(command, "$payloadSha256", envelope.PayloadSha256);

        var existing = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return existing is string value && Guid.TryParseExact(value, "N", out var captureId)
            ? captureId
            : null;
    }

    private static async Task<(long Count, long PayloadBytes)> GetRetainedUsageAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0)
            FROM delivery_queue
            WHERE delivery_state IN (0, 1, 2, 3, 4);
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException("SQLite did not return local delivery queue usage.");
        }

        return (reader.GetInt64(0), reader.GetInt64(1));
    }

    private static async Task InsertPendingCaptureAsync(
        SqliteConnection connection,
        DeliveryQueueItem item,
        int payloadBytes,
        CancellationToken cancellationToken)
    {
        var envelope = item.Envelope;
        var destination = item.Destination;

        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO delivery_queue (
                capture_id, installation_id, protocol_version, sequence, captured_at_utc_ticks,
                queued_at_utc_ticks, app_version, observation_kind, source_platform,
                source_platform_key, game_id, local_player_puuid, local_player_game_name,
                local_player_tag_line, local_player_puuid_key, envelope_server_id,
                envelope_event_id, destination_profile_id, destination_server_id,
                destination_event_id, payload_sha256, payload_json, payload_bytes,
                delivery_state, attempt_count, last_attempted_at_utc_ms,
                last_attempt_outcome, last_attempt_safe_code, next_attempt_at_utc_ms,
                acknowledged_at_utc_ms, acknowledgment_status
            ) VALUES (
                $captureId, $installationId, $protocolVersion, $sequence, $capturedAtUtcTicks,
                $queuedAtUtcTicks, $appVersion, $observationKind, $sourcePlatform,
                $sourcePlatformKey, $gameId, $localPlayerPuuid, $localPlayerGameName,
                $localPlayerTagLine, $localPlayerPuuidKey, $envelopeServerId,
                $envelopeEventId, $destinationProfileId, $destinationServerId,
                $destinationEventId, $payloadSha256, $payloadJson, $payloadBytes,
                $deliveryState, 0, NULL, NULL, NULL, NULL, NULL, NULL
            );
            """;
        AddParameter(command, "$captureId", envelope.CaptureId.ToString("N"));
        AddParameter(command, "$installationId", envelope.InstallationId.ToString("N"));
        AddParameter(command, "$protocolVersion", envelope.ProtocolVersion);
        AddParameter(command, "$sequence", envelope.Sequence);
        AddParameter(command, "$capturedAtUtcTicks", envelope.CapturedAtUtc.UtcDateTime.Ticks);
        AddParameter(command, "$queuedAtUtcTicks", item.QueuedAtUtc.UtcDateTime.Ticks);
        AddParameter(command, "$appVersion", envelope.AppVersion);
        AddParameter(command, "$observationKind", (int)envelope.ObservationKind);
        AddParameter(command, "$sourcePlatform", envelope.SourcePlatform);
        AddParameter(command, "$sourcePlatformKey", NormalizeDeduplicationComponent(envelope.SourcePlatform));
        AddParameter(command, "$gameId", envelope.GameId);
        AddParameter(command, "$localPlayerPuuid", envelope.LocalPlayer.Puuid);
        AddParameter(command, "$localPlayerGameName", envelope.LocalPlayer.GameName);
        AddParameter(command, "$localPlayerTagLine", envelope.LocalPlayer.TagLine);
        AddParameter(command, "$localPlayerPuuidKey", NormalizeDeduplicationComponent(envelope.LocalPlayer.Puuid));
        AddParameter(command, "$envelopeServerId", envelope.Context?.ServerId);
        AddParameter(command, "$envelopeEventId", envelope.Context?.EventId);
        AddParameter(command, "$destinationProfileId", destination.DestinationProfileId.ToString("N"));
        AddParameter(command, "$destinationServerId", destination.VerifiedContext?.ServerId);
        AddParameter(command, "$destinationEventId", destination.VerifiedContext?.EventId);
        AddParameter(command, "$payloadSha256", envelope.PayloadSha256);
        AddParameter(command, "$payloadJson", envelope.PayloadJson);
        AddParameter(command, "$payloadBytes", payloadBytes);
        AddParameter(command, "$deliveryState", (int)QueuedCaptureDeliveryState.Pending);

        var rowsInserted = await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        if (rowsInserted != 1)
        {
            throw new IOException("SQLite did not store the pending delivery capture.");
        }
    }

    private static string NormalizeDeduplicationComponent(string? value) => value ?? string.Empty;

    private static void AddParameter(SqliteCommand command, string parameterName, object? value) =>
        command.Parameters.AddWithValue(parameterName, value ?? DBNull.Value);

    private static async Task BeginImmediateAsync(SqliteConnection connection, CancellationToken cancellationToken) =>
        await ExecuteNonQueryAsync(connection, "BEGIN IMMEDIATE;", cancellationToken).ConfigureAwait(false);

    private static async Task CommitAsync(SqliteConnection connection, CancellationToken cancellationToken) =>
        await ExecuteNonQueryAsync(connection, "COMMIT;", cancellationToken).ConfigureAwait(false);

    private static async Task RollbackAsync(SqliteConnection connection)
    {
        try
        {
            await ExecuteNonQueryAsync(connection, "ROLLBACK;", CancellationToken.None).ConfigureAwait(false);
        }
        catch (SqliteException)
        {
            // The connection may already have rolled back after a cancelled or failed command.
        }
    }

    private static async Task ExecuteNonQueryAsync(
        SqliteConnection connection,
        string commandText,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        foreach (var parameter in parameters)
        {
            AddParameter(command, parameter.Name, parameter.Value);
        }

        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<int> ExecuteNonQueryWithRowCountAsync(
        SqliteConnection connection,
        string commandText,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        return await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<int> ExecuteNonQueryWithParametersAsync(
        SqliteConnection connection,
        string commandText,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        foreach (var parameter in parameters)
        {
            AddParameter(command, parameter.Name, parameter.Value);
        }

        return await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<object?> ExecuteScalarAsync(
        SqliteConnection connection,
        string commandText,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
    }

    private static bool IsExpectedStorageException(Exception exception) => exception is
        SqliteException or
        IOException or
        UnauthorizedAccessException or
        NotSupportedException or
        ArgumentException or
        InvalidOperationException;

    private static bool IsCorruptSqliteException(SqliteException exception) =>
        exception.SqliteErrorCode is 11 or 26;

    private static string GetDefaultDatabasePath()
    {
        var localApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localApplicationData))
        {
            throw new InvalidOperationException("The current user has no local application-data directory.");
        }

        return Path.Combine(localApplicationData, "TftPlayerRelay", "delivery-queue.db");
    }

    private sealed class UnsupportedQueueSchemaException : Exception;

    private sealed class CorruptQueueException : Exception;
}
