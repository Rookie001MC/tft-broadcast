namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// The result of saving the persisted destination document.
/// </summary>
public sealed record RelayDestinationSettingsSaveResult(
    RelayDestinationSettingsSaveStatus Status,
    string? Detail)
{
    /// <summary>Gets whether the settings document was saved.</summary>
    public bool IsSuccess => Status == RelayDestinationSettingsSaveStatus.Saved;

    /// <summary>Creates a successful save result.</summary>
    public static RelayDestinationSettingsSaveResult Saved() => new(
        RelayDestinationSettingsSaveStatus.Saved,
        null);

    /// <summary>Creates a safe failure result.</summary>
    public static RelayDestinationSettingsSaveResult Failure(string detail) => new(
        RelayDestinationSettingsSaveStatus.StorageUnavailable,
        detail);
}
