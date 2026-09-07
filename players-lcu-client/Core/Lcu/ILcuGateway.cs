using System;
using System.Threading;
using System.Threading.Tasks;

namespace players_lcu_client.Core.Lcu;

/// <summary>
/// Provides read-only access to the local League Client API.
/// </summary>
/// <remarks>
/// This boundary deliberately exposes no LCU credentials. Raw EOG bytes are available only
/// during the synchronous capture callback so an in-process capture coordinator can safely
/// copy or persist them without the gateway retaining participant data.
/// </remarks>
public interface ILcuGateway : IAsyncDisposable
{
    /// <summary>
    /// Gets the latest safe, in-memory connection and observation status.
    /// </summary>
    LcuGatewayStatus CurrentStatus { get; }

    /// <summary>
    /// Raised after safe connection or observation status changes.
    /// </summary>
    event Action<LcuGatewayStatus>? StatusChanged;

    /// <summary>
    /// Raised when the local client reports a gameflow phase.
    /// </summary>
    event Action<LcuGameflowPhaseChanged>? GameflowPhaseChanged;

    /// <summary>
    /// Raised after the TFT EOG endpoint returns a payload with a usable game identity.
    /// The raw payload is not retained by the gateway.
    /// </summary>
    event Action<LcuTftEogStatsObserved>? TftEogStatsObserved;

    /// <summary>
    /// Raised synchronously when TFT EOG stats contain a usable game ID. The supplied UTF-8 JSON
    /// is valid only for the duration of this callback and must be copied or persisted before the
    /// handler returns. Implementations must not retain it afterwards.
    /// </summary>
    event Action<LcuTftEogStatsCaptured>? TftEogStatsCaptured;

    /// <summary>
    /// Begins local LCU discovery and read-only observation. This method returns once the
    /// background discovery loop has started; it does not require the League Client to be open.
    /// </summary>
    Task StartAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Stops discovery and releases gateway-owned subscriptions.
    /// </summary>
    Task StopAsync(CancellationToken cancellationToken = default);
}
