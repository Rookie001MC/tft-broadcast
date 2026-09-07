namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// Describes the outcome of loading the local destination settings document.
/// </summary>
public enum RelayDestinationSettingsLoadStatus
{
    /// <summary>No settings document has been saved for this user.</summary>
    NotFound,

    /// <summary>A supported, valid settings document was loaded.</summary>
    Loaded,

    /// <summary>The document was malformed or did not pass destination validation.</summary>
    InvalidDocument,

    /// <summary>The document uses a schema version this application does not support.</summary>
    UnsupportedVersion,

    /// <summary>The local application-data location could not be read safely.</summary>
    StorageUnavailable,
}
