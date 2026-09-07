using players_lcu_client.Core.Configuration;

namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// Loads and saves the non-secret player-relay destination selected by the local user.
/// Credential storage deliberately belongs to a separate protected-storage boundary.
/// </summary>
public interface IRelayDestinationSettingsStore
{
    /// <summary>
    /// Loads the saved destination document without creating or repairing any local files.
    /// </summary>
    RelayDestinationSettingsLoadResult Load();

    /// <summary>
    /// Atomically replaces the saved destination document with validated non-secret settings.
    /// </summary>
    RelayDestinationSettingsSaveResult Save(RelayDestinationSettings settings);
}
