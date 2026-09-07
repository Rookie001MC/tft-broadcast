using System;

namespace players_lcu_client.Core.Delivery;

/// <summary>
/// Associates a queued capture with the destination profile selected when it was captured.
/// </summary>
/// <remarks>
/// This is intentionally a stable local profile identifier and optional receiver scope only. It
/// contains neither an origin nor a token, so changing settings cannot silently reroute queued
/// captures or expose credentials through queue state.
/// </remarks>
public sealed record DeliveryDestinationBinding(
    Guid DestinationProfileId,
    DeliveryContext? VerifiedContext);

/// <summary>
/// The delivery lifecycle for one immutable capture envelope.
/// </summary>
public enum QueuedCaptureDeliveryState
{
    /// <summary>
    /// Stored locally and eligible to be delivered.
    /// </summary>
    Pending,

    /// <summary>
    /// Claimed by the one uploader. Storage recovers this state as pending after an interrupted
    /// process so an in-flight request is never treated as acknowledged.
    /// </summary>
    Sending,

    /// <summary>
    /// A temporary failure occurred; the capture remains immutable and is waiting for its next
    /// eligible delivery time.
    /// </summary>
    RetryScheduled,

    /// <summary>
    /// Delivery needs an operator action, such as correcting a token or endpoint. It remains
    /// retained and is not automatically discarded.
    /// </summary>
    Blocked,

    /// <summary>
    /// The receiver permanently rejected this capture. It remains available for explicit export
    /// or removal and must not block later eligible captures.
    /// </summary>
    Rejected,

    /// <summary>
    /// A matching stored or duplicate receipt was durably recorded locally. Infrastructure may
    /// subsequently remove the payload while retaining bounded acknowledgment metadata.
    /// </summary>
    Acknowledged,
}

/// <summary>
/// The safe classification of a completed delivery attempt. It never contains an HTTP response,
/// bearer token, raw payload, or receiver error text.
/// </summary>
public enum DeliveryAttemptOutcome
{
    /// <summary>
    /// A request could not obtain a usable response, such as a timeout or network failure.
    /// </summary>
    NoAcknowledgment,

    /// <summary>
    /// A retryable receiver response was received.
    /// </summary>
    RetryableFailure,

    /// <summary>
    /// Delivery is blocked until settings or receiver compatibility changes.
    /// </summary>
    Blocked,

    /// <summary>
    /// The receiver rejected the immutable capture permanently.
    /// </summary>
    Rejected,

    /// <summary>
    /// A matching v1 stored or duplicate receipt was received.
    /// </summary>
    Acknowledged,
}

/// <summary>
/// A safe, immutable summary of an attempt to deliver a queued capture.
/// </summary>
/// <param name="Number">The one-based attempt number assigned by durable queue storage.</param>
/// <param name="AttemptedAtUtc">When the uploader began this attempt.</param>
/// <param name="Outcome">The safe result classification.</param>
/// <param name="SafeCode">An optional contract error code or local safe code; never raw text.</param>
/// <param name="RetryNotBeforeUtc">The next eligible time for a retry, if one was scheduled.</param>
public sealed record DeliveryAttempt(
    long Number,
    DateTimeOffset AttemptedAtUtc,
    DeliveryAttemptOutcome Outcome,
    string? SafeCode,
    DateTimeOffset? RetryNotBeforeUtc);

/// <summary>
/// The durable-receipt metadata accepted from a matching v1 acknowledgment.
/// </summary>
public sealed record DeliveryAcknowledgment(
    Guid CaptureId,
    DeliveryAcknowledgmentStatus Status,
    DateTimeOffset ReceivedAtUtc);

/// <summary>
/// The only receiver receipt statuses that acknowledge a v1 capture.
/// </summary>
public enum DeliveryAcknowledgmentStatus
{
    /// <summary>
    /// The receiver persisted the capture for the first time.
    /// </summary>
    Stored,

    /// <summary>
    /// The receiver had already persisted the same immutable capture.
    /// </summary>
    Duplicate,
}

/// <summary>
/// An immutable snapshot of a locally durable capture and its delivery state.
/// </summary>
/// <remarks>
/// State changes create a replacement snapshot; they must never alter
/// <see cref="Envelope"/>, <see cref="Destination"/>, or the capture identity. Queue storage is
/// responsible for atomically persisting the original envelope and destination before exposing a
/// pending item to an uploader.
/// </remarks>
public sealed record DeliveryQueueItem(
    CaptureEnvelope Envelope,
    DeliveryDestinationBinding Destination,
    QueuedCaptureDeliveryState State,
    DateTimeOffset QueuedAtUtc,
    long AttemptCount,
    DeliveryAttempt? LastAttempt,
    DateTimeOffset? NextAttemptAtUtc,
    DeliveryAcknowledgment? Acknowledgment);
