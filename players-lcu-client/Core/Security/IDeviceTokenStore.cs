namespace players_lcu_client.Core.Security;

/// <summary>
/// Persists an opaque device token independently from non-secret relay destination settings.
/// Implementations must never fall back to plaintext storage.
/// </summary>
public interface IDeviceTokenStore
{
    /// <summary>
    /// Loads the protected token without creating, deleting, repairing, or migrating local files.
    /// </summary>
    DeviceTokenLoadResult Load();

    /// <summary>
    /// Atomically saves a token that was already validated by <see cref="DeviceToken.TryCreate"/>.
    /// </summary>
    DeviceTokenSaveResult Save(DeviceToken token);
}
