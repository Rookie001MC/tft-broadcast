using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Configuration;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Core.Lcu;
using players_lcu_client.Infrastructure.Configuration;

namespace players_lcu_client.Infrastructure.Storage;

/// <summary>Copies borrowed LCU bytes into the durable delivery queue before the callback returns.</summary>
public sealed class SqliteTftEogCaptureStore : ITftEogCaptureStore
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly IDeliveryQueueStore _queue;
    private readonly IRelayDestinationSettingsStore _settingsStore;
    private readonly IInstallationIdentityStore _identityStore;
    private CaptureSpoolStatus _status = CaptureSpoolStatus.NotStarted;
    private int _storedCount;

    public SqliteTftEogCaptureStore(
        IDeliveryQueueStore queue,
        IRelayDestinationSettingsStore settingsStore,
        IInstallationIdentityStore identityStore)
    {
        _queue = queue;
        _settingsStore = settingsStore;
        _identityStore = identityStore;
    }

    public CaptureSpoolStatus CurrentStatus => _status;

    public event Action<CaptureSpoolStatus>? StatusChanged;

    public void Initialize()
    {
        var initialization = _queue.InitializeAsync(default).GetAwaiter().GetResult();
        SetStatus(new CaptureSpoolStatus(_storedCount, null, initialization.Detail));
    }

    public CaptureStoreResult Persist(LcuTftEogStatsCaptured capture)
    {
        try
        {
            var payloadJson = StrictUtf8.GetString(capture.Utf8Json.Span);
            var payloadBytes = StrictUtf8.GetBytes(payloadJson);
            string payloadSha256;
            try { payloadSha256 = Convert.ToHexString(SHA256.HashData(payloadBytes)).ToLowerInvariant(); }
            finally { CryptographicOperations.ZeroMemory(payloadBytes); }

            var settings = _settingsStore.Load();
            var destination = settings.Settings?.Destination ?? RelayDestination.Default;
            var identity = _identityStore.ReserveNextSequence();
            var envelope = new CaptureEnvelope(
                CaptureEnvelope.V1ProtocolVersion,
                Guid.NewGuid(),
                identity.InstallationId,
                identity.Sequence,
                capture.ObservedAtUtc,
                typeof(SqliteTftEogCaptureStore).Assembly.GetName().Version?.ToString() ?? "0.0.0",
                capture.Source == LcuObservationSource.Event ? DeliveryObservationKind.Event : DeliveryObservationKind.Recovery,
                null,
                capture.GameId,
                new DeliveryLocalPlayer(null, null, null),
                null,
                payloadSha256,
                payloadJson);
            var item = new DeliveryQueueItem(
                envelope,
                new DeliveryDestinationBinding(RelayDestinationProfile.CreateId(destination), null),
                QueuedCaptureDeliveryState.Pending,
                capture.ObservedAtUtc,
                0,
                null,
                null,
                null);
            var admitted = _queue.AdmitAsync(item).GetAwaiter().GetResult();
            if (admitted.Outcome == DeliveryQueueAdmissionOutcome.Stored)
            {
                _storedCount++;
                SetStatus(new CaptureSpoolStatus(_storedCount, capture.ObservedAtUtc, "The result was added to the delivery queue."));
                return new CaptureStoreResult(true, false, admitted.CaptureId, admitted.Detail);
            }

            return new CaptureStoreResult(false, admitted.Outcome == DeliveryQueueAdmissionOutcome.Duplicate, admitted.CaptureId, admitted.Detail);
        }
        catch (Exception exception) when (exception is DecoderFallbackException or IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            return new CaptureStoreResult(false, false, null, "The result could not be added to the delivery queue.");
        }
    }

    private void SetStatus(CaptureSpoolStatus status)
    {
        _status = status;
        StatusChanged?.Invoke(status);
    }
}
