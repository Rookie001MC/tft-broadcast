using System;
using System.Globalization;

namespace players_lcu_client.Core.Configuration;

/// <summary>
/// A validated TCP port for a player-relay receiver destination.
/// </summary>
public sealed record RelayPort
{
    private RelayPort(int value)
    {
        Value = value;
    }

    /// <summary>
    /// Gets the TCP port number, always between 1 and 65535 inclusive.
    /// </summary>
    public int Value { get; }

    /// <summary>
    /// Validates a port number between 1 and 65535 inclusive.
    /// </summary>
    public static bool TryCreate(int value, out RelayPort? port)
    {
        if (value is < 1 or > 65535)
        {
            port = null;
            return false;
        }

        port = new RelayPort(value);
        return true;
    }

    /// <summary>
    /// Parses an unsigned decimal port number without accepting signs, whitespace, or cultures.
    /// </summary>
    public static bool TryParse(string? value, out RelayPort? port)
    {
        if (string.IsNullOrEmpty(value)
            || !int.TryParse(
                value,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var parsedPort))
        {
            port = null;
            return false;
        }

        return TryCreate(parsedPort, out port);
    }

    /// <inheritdoc />
    public override string ToString() => Value.ToString(CultureInfo.InvariantCulture);
}
