using System;
using players_lcu_client.Core.Lcu;

namespace players_lcu_client.Core.Capture;

/// <summary>
/// Durable, local storage for raw TFT end-of-game observations.
/// </summary>
public interface ITftEogCaptureStore
{
    /// <summary>
    /// Gets the latest safe status. It deliberately contains no EOG payload or player data.
    /// </summary>
    CaptureSpoolStatus CurrentStatus { get; }

    /// <summary>
    /// Raised after the safe spool status changes.
    /// </summary>
    event Action<CaptureSpoolStatus>? StatusChanged;

    /// <summary>
    /// Prepares the on-disk spool and reconstructs its deduplication index.
    /// </summary>
    void Initialize();

    /// <summary>
    /// Synchronously copies the borrowed LCU bytes into durable local storage. The call must
    /// finish before the LCU callback returns because the source buffer is then cleared.
    /// </summary>
    CaptureStoreResult Persist(LcuTftEogStatsCaptured capture);
}
