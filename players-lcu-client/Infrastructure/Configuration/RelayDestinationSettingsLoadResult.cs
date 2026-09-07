using players_lcu_client.Core.Configuration;

namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// The result of loading the persisted destination document.
/// </summary>
public sealed record RelayDestinationSettingsLoadResult(
    RelayDestinationSettingsLoadStatus Status,
    RelayDestinationSettings? Settings,
    string? Detail)
{
    /// <summary>
    /// Gets whether a validated destination is available to the caller.
    /// </summary>
    public bool HasSettings => Settings is not null;

    /// <summary>
    /// Creates the result used when no document exists. The default is returned for presentation
    /// only and is not written until the caller explicitly saves it.
    /// </summary>
    public static RelayDestinationSettingsLoadResult NotFound() => new(
        RelayDestinationSettingsLoadStatus.NotFound,
        RelayDestinationSettings.Default,
        null);

    /// <summary>Creates a successfully loaded result.</summary>
    public static RelayDestinationSettingsLoadResult Loaded(RelayDestinationSettings settings) => new(
        RelayDestinationSettingsLoadStatus.Loaded,
        settings,
        null);

    /// <summary>Creates a safe failure result without an unvalidated destination.</summary>
    public static RelayDestinationSettingsLoadResult Failure(
        RelayDestinationSettingsLoadStatus status,
        string detail) => new(status, null, detail);
}
