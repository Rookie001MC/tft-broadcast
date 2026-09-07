namespace players_lcu_client.Core.Configuration;

/// <summary>
/// The transport scheme supported by a player-relay receiver destination.
/// </summary>
public enum RelayDestinationScheme
{
    Http,
    Https,
}

internal static class RelayDestinationSchemeExtensions
{
    public static bool TryParse(
        string? value,
        out RelayDestinationScheme scheme)
    {
        if (string.Equals(value, "http", System.StringComparison.OrdinalIgnoreCase))
        {
            scheme = RelayDestinationScheme.Http;
            return true;
        }

        if (string.Equals(value, "https", System.StringComparison.OrdinalIgnoreCase))
        {
            scheme = RelayDestinationScheme.Https;
            return true;
        }

        scheme = default;
        return false;
    }

    public static string ToUriScheme(this RelayDestinationScheme scheme) => scheme switch
    {
        RelayDestinationScheme.Http => "http",
        RelayDestinationScheme.Https => "https",
        _ => throw new System.ArgumentOutOfRangeException(nameof(scheme)),
    };
}
