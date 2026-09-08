using System;

namespace players_lcu_client.Core.Delivery;

/// <summary>Provides a durable installation identity and monotonic local capture sequence.</summary>
public interface IInstallationIdentityStore
{
    InstallationSequence ReserveNextSequence();
}

/// <summary>A single durable installation-local sequence reservation.</summary>
public sealed record InstallationSequence(Guid InstallationId, string Sequence);
