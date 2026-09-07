namespace players_lcu_client.Core.Security;

/// <summary>
/// Describes the safe outcome of reading a locally protected device token.
/// </summary>
public enum DeviceTokenLoadStatus
{
    /// <summary>No protected token has been saved for this user.</summary>
    NotFound,

    /// <summary>A valid token was decrypted for the current Windows user.</summary>
    Available,

    /// <summary>Credential protection is not available on the current platform.</summary>
    Unavailable,

    /// <summary>The retained protected credential cannot be decrypted or validated.</summary>
    Unreadable,

    /// <summary>The local credential file could not be read safely.</summary>
    StorageUnavailable,
}
