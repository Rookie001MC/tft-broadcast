namespace players_lcu_client.Core.Security;

/// <summary>
/// Describes the safe outcome of saving a protected device token.
/// </summary>
public enum DeviceTokenSaveStatus
{
    /// <summary>The complete protected token file was atomically replaced.</summary>
    Saved,

    /// <summary>Credential protection is not available on the current platform.</summary>
    Unavailable,

    /// <summary>The protected token file could not be written safely.</summary>
    StorageUnavailable,
}
