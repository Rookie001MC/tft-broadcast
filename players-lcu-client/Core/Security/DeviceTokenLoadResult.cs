using System;

namespace players_lcu_client.Core.Security;

/// <summary>
/// A token-load outcome designed to remain safe when rendered or logged. It never formats the
/// contained token value.
/// </summary>
public sealed class DeviceTokenLoadResult
{
    private DeviceTokenLoadResult(
        DeviceTokenLoadStatus status,
        DeviceToken? token,
        string? detail)
    {
        Status = status;
        Token = token;
        Detail = detail;
    }

    /// <summary>Gets the classified outcome.</summary>
    public DeviceTokenLoadStatus Status { get; }

    /// <summary>
    /// Gets the credential only when <see cref="Status"/> is
    /// <see cref="DeviceTokenLoadStatus.Available"/>. Its <see cref="object.ToString"/>
    /// implementation is redacted.
    /// </summary>
    public DeviceToken? Token { get; }

    /// <summary>Gets a safe, non-secret operator-facing detail.</summary>
    public string? Detail { get; }

    /// <summary>Gets whether a usable token is available.</summary>
    public bool HasToken => Status == DeviceTokenLoadStatus.Available && Token is not null;

    /// <summary>Creates a result for an absent credential file.</summary>
    public static DeviceTokenLoadResult NotFound() => new(
        DeviceTokenLoadStatus.NotFound,
        token: null,
        detail: null);

    /// <summary>Creates a result containing a decrypted, validated credential.</summary>
    public static DeviceTokenLoadResult Available(DeviceToken token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return new(DeviceTokenLoadStatus.Available, token, detail: null);
    }

    /// <summary>Creates a safe explicit platform/protection-unavailable result.</summary>
    public static DeviceTokenLoadResult Unavailable() => new(
        DeviceTokenLoadStatus.Unavailable,
        token: null,
        detail: "Windows user-bound credential protection is unavailable.");

    /// <summary>
    /// Creates a result for a protected file that must be retained for explicit operator recovery.
    /// </summary>
    public static DeviceTokenLoadResult Unreadable() => new(
        DeviceTokenLoadStatus.Unreadable,
        token: null,
        detail: "The saved device token cannot be unlocked for this Windows user.");

    /// <summary>Creates a result for a safe local-storage failure.</summary>
    public static DeviceTokenLoadResult StorageUnavailable() => new(
        DeviceTokenLoadStatus.StorageUnavailable,
        token: null,
        detail: "Protected device-token storage is unavailable.");

    /// <inheritdoc />
    public override string ToString() =>
        $"{nameof(DeviceTokenLoadResult)} {{ Status = {Status}, HasToken = {HasToken}, Detail = {Detail} }}";
}
