using System;

namespace players_lcu_client.Core.Configuration;

/// <summary>
/// Identifies a validated player-relay HTTP receiver. This type deliberately contains no token,
/// server identity, event identity, or other credential material.
/// </summary>
public sealed record RelayDestination
{
    private readonly Uri _baseUri;

    private RelayDestination(
        RelayDestinationScheme scheme,
        RelayHost host,
        RelayPort port)
    {
        Scheme = scheme;
        Host = host;
        Port = port;
        _baseUri = CreateBaseUri(scheme, host, port);
    }

    /// <summary>
    /// Gets the trusted-LAN default destination: <c>http://127.0.0.1:5173</c>.
    /// </summary>
    public static RelayDestination Default { get; } = CreateDefault();

    /// <summary>
    /// Gets the scheme used for receiver requests.
    /// </summary>
    public RelayDestinationScheme Scheme { get; }

    /// <summary>
    /// Gets the validated host without a scheme, port, path, or credentials.
    /// </summary>
    public RelayHost Host { get; }

    /// <summary>
    /// Gets the validated TCP port.
    /// </summary>
    public RelayPort Port { get; }

    /// <summary>
    /// Gets the root URI for this destination. It never contains user information or a token.
    /// </summary>
    public Uri BaseUri => _baseUri;

    /// <summary>
    /// Creates a validated destination from UI-style scheme, host, and port input.
    /// </summary>
    public static bool TryCreate(
        string? scheme,
        string? host,
        string? port,
        out RelayDestination? destination,
        out RelayDestinationValidationError error)
    {
        destination = null;

        if (!RelayDestinationSchemeExtensions.TryParse(scheme, out var parsedScheme))
        {
            error = RelayDestinationValidationError.InvalidScheme;
            return false;
        }

        if (!RelayHost.TryCreate(host, out var parsedHost))
        {
            error = RelayDestinationValidationError.InvalidHost;
            return false;
        }

        if (!RelayPort.TryParse(port, out var parsedPort))
        {
            error = RelayDestinationValidationError.InvalidPort;
            return false;
        }

        destination = new RelayDestination(parsedScheme, parsedHost, parsedPort);
        error = RelayDestinationValidationError.None;
        return true;
    }

    /// <summary>
    /// Creates a destination from already validated value objects.
    /// </summary>
    public static RelayDestination Create(
        RelayDestinationScheme scheme,
        RelayHost host,
        RelayPort port)
    {
        ArgumentNullException.ThrowIfNull(host);
        ArgumentNullException.ThrowIfNull(port);

        if (scheme is not RelayDestinationScheme.Http and not RelayDestinationScheme.Https)
        {
            throw new ArgumentOutOfRangeException(nameof(scheme));
        }

        return new RelayDestination(scheme, host, port);
    }

    /// <summary>
    /// Builds a receiver endpoint URI beneath this destination root. The supplied value must be
    /// an absolute path only; queries, fragments, backslashes, and authority-like paths are not
    /// accepted so endpoint input cannot alter the destination host or port.
    /// </summary>
    public Uri BuildEndpointUri(string absolutePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(absolutePath);

        if (absolutePath[0] != '/'
            || absolutePath.StartsWith("//", StringComparison.Ordinal)
            || absolutePath.IndexOfAny(['?', '#', '\\']) >= 0
            || ContainsControlOrWhitespace(absolutePath)
            || HasDotSegment(absolutePath))
        {
            throw new ArgumentException(
                "The endpoint must be a canonical absolute path without a query or fragment.",
                nameof(absolutePath));
        }

        var builder = new UriBuilder(Scheme.ToUriScheme(), Host.Value, Port.Value)
        {
            Path = absolutePath,
        };

        return builder.Uri;
    }

    /// <inheritdoc />
    public override string ToString() => BaseUri.AbsoluteUri;

    private static Uri CreateBaseUri(
        RelayDestinationScheme scheme,
        RelayHost host,
        RelayPort port) => new UriBuilder(
            scheme.ToUriScheme(),
            host.Value,
            port.Value).Uri;

    private static RelayDestination CreateDefault()
    {
        if (!RelayHost.TryCreate("127.0.0.1", out var host)
            || !RelayPort.TryCreate(5173, out var port))
        {
            throw new InvalidOperationException("The built-in relay destination is invalid.");
        }

        return new RelayDestination(RelayDestinationScheme.Http, host, port);
    }

    private static bool ContainsControlOrWhitespace(string value)
    {
        foreach (var character in value)
        {
            if (char.IsControl(character) || char.IsWhiteSpace(character))
            {
                return true;
            }
        }

        return false;
    }

    private static bool HasDotSegment(string path)
    {
        foreach (var segment in path.Split('/', StringSplitOptions.None))
        {
            if (segment is "." or "..")
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// Identifies the first invalid field when parsing destination input.
/// </summary>
public enum RelayDestinationValidationError
{
    None,
    InvalidScheme,
    InvalidHost,
    InvalidPort,
}
