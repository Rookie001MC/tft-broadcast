namespace players_lcu_client.Core.Security;

/// <summary>
/// A token-save outcome designed to remain safe when rendered or logged. It contains neither a
/// token nor encrypted credential bytes.
/// </summary>
public sealed class DeviceTokenSaveResult
{
    private DeviceTokenSaveResult(DeviceTokenSaveStatus status, string? detail)
    {
        Status = status;
        Detail = detail;
    }

    /// <summary>Gets the classified outcome.</summary>
    public DeviceTokenSaveStatus Status { get; }

    /// <summary>Gets a safe, non-secret operator-facing detail.</summary>
    public string? Detail { get; }

    /// <summary>Gets whether the token was durably saved.</summary>
    public bool IsSuccess => Status == DeviceTokenSaveStatus.Saved;

    /// <summary>Creates a successful save result.</summary>
    public static DeviceTokenSaveResult Saved() => new(DeviceTokenSaveStatus.Saved, detail: null);

    /// <summary>Creates a safe explicit platform/protection-unavailable result.</summary>
    public static DeviceTokenSaveResult Unavailable() => new(
        DeviceTokenSaveStatus.Unavailable,
        "Windows user-bound credential protection is unavailable.");

    /// <summary>Creates a safe local-storage-failure result.</summary>
    public static DeviceTokenSaveResult StorageUnavailable() => new(
        DeviceTokenSaveStatus.StorageUnavailable,
        "Protected device-token storage is unavailable.");

    /// <inheritdoc />
    public override string ToString() =>
        $"{nameof(DeviceTokenSaveResult)} {{ Status = {Status}, IsSuccess = {IsSuccess}, Detail = {Detail} }}";
}
