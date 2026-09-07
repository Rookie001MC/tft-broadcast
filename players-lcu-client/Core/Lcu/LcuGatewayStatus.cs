using System;

namespace players_lcu_client.Core.Lcu;

/// <summary>
/// The state of the local, read-only LCU connection.
/// </summary>
public enum LcuGatewayConnectionState
{
    Stopped,
    Searching,
    Connecting,
    Connected,
    Reconnecting,
}

/// <summary>
/// What the read-only gateway most recently established about the TFT EOG endpoint.
/// </summary>
public enum LcuTftEogStatsEndpointState
{
    Unknown,
    NoData,
    Available,
    Unsupported,
    Unavailable,
    Oversized,
}

/// <summary>
/// A safe snapshot suitable for a future status UI or diagnostics export.
/// It contains no LCU credentials, URI, raw JSON, account identity, or participant data.
/// </summary>
public sealed record LcuGatewayStatus(
    LcuGatewayConnectionState ConnectionState,
    DateTimeOffset UpdatedAtUtc,
    string? GameflowPhase,
    DateTimeOffset? GameflowPhaseObservedAtUtc,
    LcuTftEogStatsEndpointState TftEogStatsEndpointState,
    DateTimeOffset? TftEogStatsObservedAtUtc,
    string Detail)
{
    public static LcuGatewayStatus Stopped { get; } = new(
        LcuGatewayConnectionState.Stopped,
        DateTimeOffset.UtcNow,
        null,
        null,
        LcuTftEogStatsEndpointState.Unknown,
        null,
        "LCU observation is stopped.");
}
