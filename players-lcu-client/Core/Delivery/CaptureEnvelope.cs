using System;

namespace players_lcu_client.Core.Delivery;

/// <summary>
/// Identifies how the relay observed an end-of-game result. These values map to the v1
/// <c>observationKind</c> values when an envelope is serialized.
/// </summary>
public enum DeliveryObservationKind
{
    /// <summary>
    /// The observation followed a live LCU event.
    /// </summary>
    Event,

    /// <summary>
    /// The observation was found by a startup, reconnect, or resume read.
    /// </summary>
    Recovery,
}

/// <summary>
/// The local player identity included in a delivery envelope. Every member may be unavailable;
/// callers must not substitute identity from another account or later LCU read.
/// </summary>
public sealed record DeliveryLocalPlayer(
    string? Puuid,
    string? GameName,
    string? TagLine);

/// <summary>
/// The receiver-owned scope returned by a successful v1 handshake. It is an identifier only and
/// does not assert that an observation belongs to a current tournament match.
/// </summary>
public sealed record DeliveryContext(
    string ServerId,
    string EventId);

/// <summary>
/// The immutable v1 body submitted for one locally observed TFT result.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="PayloadJson"/> is the original EOG JSON text. It is opaque at this boundary: code
/// storing, queueing, or retrying this record must not parse, normalize, reformat, or reserialize
/// it. <see cref="PayloadSha256"/> is the lowercase hexadecimal SHA-256 of the UTF-8 bytes of
/// that exact string.
/// </para>
/// <para>
/// <see cref="Sequence"/> deliberately remains a decimal string because that is the wire
/// representation and avoids lossy number conversion. Transport serializers are responsible for
/// emitting v1's lowercase UUID and JSON property conventions without changing this record.
/// </para>
/// </remarks>
public sealed record CaptureEnvelope(
    int ProtocolVersion,
    Guid CaptureId,
    Guid InstallationId,
    string Sequence,
    DateTimeOffset CapturedAtUtc,
    string AppVersion,
    DeliveryObservationKind ObservationKind,
    string? SourcePlatform,
    string GameId,
    DeliveryLocalPlayer LocalPlayer,
    DeliveryContext? Context,
    string PayloadSha256,
    string PayloadJson)
{
    /// <summary>
    /// The only protocol version supported by the proposed receiver contract.
    /// </summary>
    public const int V1ProtocolVersion = 1;
}
