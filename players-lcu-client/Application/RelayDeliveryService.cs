using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using players_lcu_client.Core.Configuration;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Core.Security;
using players_lcu_client.Infrastructure.Configuration;
using players_lcu_client.Infrastructure.Transport;

namespace players_lcu_client.Application;

/// <summary>Runs the sole queue uploader without blocking LCU observation or the UI thread.</summary>
public sealed class RelayDeliveryService : IApplicationLifecycleService
{
    private readonly IDeliveryQueueStore _queue;
    private readonly IRelayDestinationSettingsStore _settingsStore;
    private readonly IDeviceTokenStore _tokenStore;
    private readonly IRelayReceiverClient _receiver;
    private readonly ILogger<RelayDeliveryService> _logger;
    private CancellationTokenSource? _lifetime;
    private Task? _worker;

    public RelayDeliveryService(
        IDeliveryQueueStore queue,
        IRelayDestinationSettingsStore settingsStore,
        IDeviceTokenStore tokenStore,
        IRelayReceiverClient receiver,
        ILogger<RelayDeliveryService> logger)
    {
        _queue = queue;
        _settingsStore = settingsStore;
        _tokenStore = tokenStore;
        _receiver = receiver;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var initialization = await _queue.InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (initialization.Status != DeliveryQueueInitializationStatus.Ready)
            throw new InvalidOperationException(initialization.Detail);
        _lifetime = new CancellationTokenSource();
        _worker = Task.Run(() => RunAsync(_lifetime.Token), CancellationToken.None);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _lifetime?.Cancel();
        if (_worker is not null)
            await _worker.WaitAsync(cancellationToken).ConfigureAwait(false);
        _lifetime?.Dispose();
        _lifetime = null;
        _worker = null;
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var lease = await _queue.ClaimNextAsync(now, cancellationToken).ConfigureAwait(false);
                if (lease is null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
                    continue;
                }

                var completion = await DeliverAsync(lease, now, cancellationToken).ConfigureAwait(false);
                await _queue.CompleteAttemptAsync(lease, completion, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Relay delivery worker failed safely; pending captures remain queued.");
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task<DeliveryAttemptCompletion> DeliverAsync(
        DeliveryQueueLease lease,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var settings = _settingsStore.Load();
        if (settings.Settings is null)
            return DeliveryAttemptCompletion.Retry("destination_unavailable", nowUtc.AddMinutes(1));
        var destination = settings.Settings.Destination;
        if (RelayDestinationProfile.CreateId(destination) != lease.Item.Destination.DestinationProfileId)
            return DeliveryAttemptCompletion.Blocked("destination_changed");
        var token = _tokenStore.Load();
        if (!token.HasToken || token.Token is null)
            return DeliveryAttemptCompletion.Retry("credential_unavailable", nowUtc.AddMinutes(1));
        return await _receiver.DeliverAsync(lease.Item.Envelope, destination, token.Token, nowUtc, cancellationToken).ConfigureAwait(false);
    }
}
