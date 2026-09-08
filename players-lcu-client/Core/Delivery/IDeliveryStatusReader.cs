using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace players_lcu_client.Core.Delivery;

/// <summary>Bounded delivery metadata for the operator UI, without capture payloads.</summary>
public interface IDeliveryStatusReader
{
    Task<IReadOnlyList<DeliveryStatusItem>> ReadDeliveryStatusAsync(int limit, CancellationToken cancellationToken);
}

public sealed record DeliveryStatusItem(
    string GameId,
    string CaptureId,
    QueuedCaptureDeliveryState State,
    long AttemptCount,
    string? SafeCode,
    DateTimeOffset? NextAttemptAtUtc,
    DateTimeOffset? ReceivedAtUtc);
