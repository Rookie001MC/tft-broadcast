using System;

namespace players_lcu_client.Core.Configuration;

/// <summary>
/// A validated receiver host name or IP address, without a scheme, port, path, or credentials.
/// </summary>
public sealed record RelayHost
{
    private RelayHost(string value)
    {
        Value = value;
    }

    /// <summary>
    /// Gets the host in the form accepted by <see cref="UriBuilder.Host"/>.
    /// IPv6 addresses are deliberately stored without brackets.
    /// </summary>
    public string Value { get; }

    /// <summary>
    /// Validates a hostname, IPv4 address, or unbracketed IPv6 address.
    /// </summary>
    public static bool TryCreate(string? value, out RelayHost? host)
    {
        host = null;

        if (string.IsNullOrWhiteSpace(value)
            || !string.Equals(value, value.Trim(), StringComparison.Ordinal)
            || value.Length > 253
            || ContainsDisallowedCharacter(value))
        {
            return false;
        }

        var type = Uri.CheckHostName(value);
        if (type is not UriHostNameType.Dns
            and not UriHostNameType.IPv4
            and not UriHostNameType.IPv6)
        {
            return false;
        }

        host = new RelayHost(value);
        return true;
    }

    /// <inheritdoc />
    public override string ToString() => Value;

    private static bool ContainsDisallowedCharacter(string value)
    {
        foreach (var character in value)
        {
            if (char.IsControl(character)
                || char.IsWhiteSpace(character)
                || character is '/' or '\\' or '?' or '#' or '@' or '[' or ']' or '%')
            {
                return true;
            }
        }

        return false;
    }
}
