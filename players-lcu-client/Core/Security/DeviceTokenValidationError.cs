namespace players_lcu_client.Core.Security;

/// <summary>
/// Describes why caller-supplied device-token text cannot be retained.
/// </summary>
public enum DeviceTokenValidationError
{
    /// <summary>The value is a valid non-empty bounded UTF-8 token.</summary>
    None,

    /// <summary>The value is absent, empty, or consists only of whitespace.</summary>
    Missing,

    /// <summary>The value cannot be encoded as strict UTF-8.</summary>
    InvalidEncoding,

    /// <summary>The value exceeds the credential-store byte limit.</summary>
    TooLarge,
}
