using System;

namespace players_lcu_client.Core.Lcu;

/// <summary>
/// Identifies whether an LCU observation was prompted by a live event or a recovery read.
/// </summary>
public enum LcuObservationSource
{
    Event,
    Recovery,
}

/// <summary>
/// A safe gameflow transition observation.
/// </summary>
public sealed record LcuGameflowPhaseChanged(
    string? Phase,
    DateTimeOffset ObservedAtUtc,
    LcuObservationSource Source);

/// <summary>
/// A safe confirmation that the TFT EOG endpoint returned a payload with a usable game ID.
/// </summary>
public sealed record LcuTftEogStatsObserved(
    DateTimeOffset ObservedAtUtc,
    LcuObservationSource Source);

/// <summary>
/// An in-process TFT EOG capture. The UTF-8 JSON memory is borrowed and valid only while the
/// gateway invokes the event handler; consumers must synchronously copy or persist it.
/// </summary>
public readonly record struct LcuTftEogStatsCaptured(
    ReadOnlyMemory<byte> Utf8Json,
    string GameId,
    DateTimeOffset ObservedAtUtc,
    LcuObservationSource Source);
