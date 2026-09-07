using System.Security.Cryptography;
using System.Text;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Infrastructure.Storage;

namespace players_lcu_client.tests.Infrastructure.Storage;

public sealed class SqliteDeliveryQueueStoreTests : IDisposable
{
    private readonly string _rootDirectory = Path.Combine(Path.GetTempPath(), $"TftPlayerRelayTests-{Guid.NewGuid():N}");

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
        new(Path.Combine(_rootDirectory, "delivery-queue.db"));

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
