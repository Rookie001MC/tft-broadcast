using System;

namespace players_lcu_client.Core.Configuration;

/// <summary>
/// The non-secret destination settings that may be retained by a future configuration store.
/// Authentication tokens deliberately belong to a separate protected-credential boundary and
/// are not represented here.
/// </summary>
public sealed record RelayDestinationSettings
{
    public RelayDestinationSettings(RelayDestination destination)
    {
        Destination = destination ?? throw new ArgumentNullException(nameof(destination));
    }

    /// <summary>
    /// Gets the default non-secret settings for a receiver on the local Player PC.
    /// </summary>
    public static RelayDestinationSettings Default { get; } = new(RelayDestination.Default);

    /// <summary>
    /// Gets the validated receiver destination.
    /// </summary>
    public RelayDestination Destination { get; }

    /// <inheritdoc />
    public override string ToString() => Destination.ToString();
}
