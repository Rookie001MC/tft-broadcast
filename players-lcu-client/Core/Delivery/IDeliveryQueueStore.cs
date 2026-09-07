using System;
using System.Threading;
using System.Threading.Tasks;

namespace players_lcu_client.Core.Delivery;

/// <summary>
/// The payload-free outcome of preparing the durable delivery queue for this process instance.
/// </summary>
public enum DeliveryQueueInitializationStatus
{
    /// <summary>
    /// The supported schema is ready and interrupted sends, if any, were recovered.
    /// </summary>
    Ready,

    /// <summary>
    /// The database uses a schema version that this application must not modify.
    /// </summary>
    UnsupportedSchema,

    /// <summary>
    /// The database or its supported schema failed integrity validation and was preserved.
    /// </summary>
    Corrupt,

    /// <summary>
    /// Local durable storage could not be opened or prepared.
    /// </summary>
    StorageUnavailable,
}

/// <summary>
/// A safe initialization result that contains no capture payload, path, or credential data.
/// </summary>
public sealed record DeliveryQueueInitialization(
    DeliveryQueueInitializationStatus Status,
    int RecoveredInterruptedSendingCount,
    string Detail);

/// <summary>
/// The durable outcome of attempting to admit one immutable capture to the delivery queue.
/// </summary>
public enum DeliveryQueueAdmissionOutcome
{
    /// <summary>
    /// The envelope, destination binding, and initial delivery state were committed together.
    /// </summary>
    Stored,

    /// <summary>
    /// An identical capture already exists within the queue's deduplication retention window.
    /// </summary>
    Duplicate,

    /// <summary>
    /// A previously retained capture ID was submitted with different immutable content. The
    /// original capture remains unchanged and the caller must surface the conflict safely.
    /// </summary>
    CaptureIdConflict,

    /// <summary>
    /// The queue limit prevented admission; existing queued records were preserved.
    /// </summary>
    CapacityReached,

    /// <summary>
    /// The capture failed the queue's local invariant or configured size checks.
    /// </summary>
    Invalid,

    /// <summary>
    /// Local durable storage could not accept the capture. Existing queued records were preserved.
    /// </summary>
    StorageUnavailable,
}

/// <summary>
/// A payload-free result of admitting an item into the durable delivery queue.
/// </summary>
public sealed record DeliveryQueueAdmission(
    DeliveryQueueAdmissionOutcome Outcome,
    Guid? CaptureId,
    string Detail);

/// <summary>
/// Dependency-free boundary for the transactional admission of immutable capture envelopes.
/// </summary>
/// <remarks>
/// An implementation must commit the envelope, its payload, identity, hash, sequence, destination
/// binding, and initial pending state in one transaction before returning <see cref="DeliveryQueueAdmissionOutcome.Stored"/>.
/// It must not expose the item's payload through <see cref="DeliveryQueueAdmission"/>.
/// Delivery scheduling, transport, and concrete SQLite details intentionally remain outside this
/// Core boundary.
/// </remarks>
public interface IDeliveryQueueStore
{
    /// <summary>
    /// Atomically creates or validates the queue schema and recovers sends interrupted before this
    /// store instance started. A successful call is idempotent for the lifetime of the instance.
    /// </summary>
    Task<DeliveryQueueInitialization> InitializeAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Atomically admits a new immutable capture. The supplied item must be in
    /// <see cref="QueuedCaptureDeliveryState.Pending"/> with no delivery attempts or receipt.
    /// </summary>
    Task<DeliveryQueueAdmission> AdmitAsync(
        DeliveryQueueItem item,
        CancellationToken cancellationToken = default);
}
