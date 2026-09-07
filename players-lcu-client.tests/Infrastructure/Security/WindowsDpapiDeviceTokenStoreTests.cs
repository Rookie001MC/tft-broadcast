using System.Security.Cryptography;
using System.Text;
using players_lcu_client.Core.Security;
using players_lcu_client.Infrastructure.Security;

namespace players_lcu_client.tests.Infrastructure.Security;

public sealed class WindowsDpapiDeviceTokenStoreTests : IDisposable
{
    private const string TestTokenText = "test-device-token-8f9eafb6-6897-44ad-aaf1-1cafad40a15d";
    private readonly string _rootDirectory = Path.Combine(Path.GetTempPath(), $"TftPlayerRelayTests-{Guid.NewGuid():N}");

    [Fact]
    public void NonWindows_LoadAndSave_ReturnUnavailableWithoutCreatingPlaintextStorage()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The test deliberately verifies this Windows API's runtime guard.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
        Assert.True(DeviceToken.TryCreate(TestTokenText, out var token, out _));
        Assert.NotNull(token);

        var load = store.Load();
        var save = store.Save(token);

        Assert.Equal(DeviceTokenLoadStatus.Unavailable, load.Status);
        Assert.False(load.HasToken);
        Assert.Null(load.Token);
        Assert.Equal(DeviceTokenSaveStatus.Unavailable, save.Status);
        Assert.False(save.IsSuccess);
        Assert.False(File.Exists(store.TokenPath));
        Assert.False(Directory.Exists(_rootDirectory));
        Assert.DoesNotContain(TestTokenText, load.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(TestTokenText, save.ToString(), StringComparison.Ordinal);
#pragma warning restore CA1416
    }

    [Fact]
    public void Windows_SaveThenLoad_RoundTripsCurrentUserProtectedTokenWithoutPlaintext()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
#pragma warning restore CA1416
        Assert.True(DeviceToken.TryCreate(TestTokenText, out var expectedToken, out _));
        Assert.NotNull(expectedToken);

        var saved = store.Save(expectedToken);
        var loaded = store.Load();

        Assert.Equal(DeviceTokenSaveStatus.Saved, saved.Status);
        Assert.True(saved.IsSuccess);
        Assert.Equal(DeviceTokenLoadStatus.Available, loaded.Status);
        Assert.True(loaded.HasToken);
        Assert.NotNull(loaded.Token);
        Assert.Equal("[redacted device token]", loaded.Token.ToString());
        Assert.DoesNotContain(TestTokenText, loaded.ToString(), StringComparison.Ordinal);

        var expectedBytes = expectedToken.EncodeUtf8();
        var actualBytes = loaded.Token.EncodeUtf8();
        var persistedBytes = File.ReadAllBytes(store.TokenPath);
        try
        {
            Assert.Equal(expectedBytes, actualBytes);
            Assert.True(persistedBytes.AsSpan(0, 4).SequenceEqual("TPLR"u8));
            Assert.True(persistedBytes.AsSpan().IndexOf(expectedBytes) < 0);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(expectedBytes);
            CryptographicOperations.ZeroMemory(actualBytes);
            CryptographicOperations.ZeroMemory(persistedBytes);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootDirectory))
        {
            Directory.Delete(_rootDirectory, recursive: true);
        }
    }
}
