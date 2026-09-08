using System;
using System.Security.Cryptography;
using System.Text;
using players_lcu_client.Core.Configuration;

namespace players_lcu_client.Core.Delivery;

/// <summary>
/// Creates a stable local profile identifier for a validated receiver origin. A changed origin
/// produces a different identifier, preventing old captures from being silently rerouted.
/// </summary>
public static class RelayDestinationProfile
{
    public static Guid CreateId(RelayDestination destination)
    {
        ArgumentNullException.ThrowIfNull(destination);
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(destination.BaseUri.AbsoluteUri));
        try
        {
            return new Guid(bytes.AsSpan(0, 16));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }
}
