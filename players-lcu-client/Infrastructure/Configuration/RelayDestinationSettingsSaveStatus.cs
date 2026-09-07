namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// Describes the outcome of writing the local destination settings document.
/// </summary>
public enum RelayDestinationSettingsSaveStatus
{
    /// <summary>The complete settings document was durably replaced.</summary>
    Saved,

    /// <summary>The local application-data location could not be written safely.</summary>
    StorageUnavailable,
}
