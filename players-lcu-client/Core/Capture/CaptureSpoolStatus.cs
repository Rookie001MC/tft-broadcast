using System;

namespace players_lcu_client.Core.Capture;

/// <summary>
/// A payload-free status snapshot for the emergency local capture spool.
/// </summary>
public sealed record CaptureSpoolStatus(
    int StoredCaptureCount,
    DateTimeOffset? LastCapturedAtUtc,
    string Detail)
{
    public static CaptureSpoolStatus NotStarted { get; } = new(
        0,
        null,
        "Capture spool has not started.");
}

/// <summary>
/// Result of one attempt to write an EOG payload to the local spool.
/// </summary>
public sealed record CaptureStoreResult(
    bool IsStored,
    bool IsDuplicate,
    Guid? CaptureId,
    string Detail);
