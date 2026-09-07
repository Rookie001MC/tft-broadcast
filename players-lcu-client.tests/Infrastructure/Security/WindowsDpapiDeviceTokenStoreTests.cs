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
    public void MissingRoot_ReturnsTypedAvailabilityWithoutCreatingStorage()
    {
#pragma warning disable CA1416 // The store itself verifies the Windows-only API at runtime.
        var store = new WindowsDpapiDeviceTokenStore(null!, "device-token.dat");
        Assert.True(DeviceToken.TryCreate(TestTokenText, out var token, out _));
        Assert.NotNull(token);

        var load = store.Load();
        var save = store.Save(token);

        if (OperatingSystem.IsWindows())
        {
            Assert.Equal(DeviceTokenLoadStatus.StorageUnavailable, load.Status);
            Assert.Equal(DeviceTokenSaveStatus.StorageUnavailable, save.Status);
        }
        else
        {
            Assert.Equal(DeviceTokenLoadStatus.Unavailable, load.Status);
            Assert.Equal(DeviceTokenSaveStatus.Unavailable, save.Status);
        }

        Assert.False(File.Exists(store.TokenPath));
#pragma warning restore CA1416
    }

    [Fact]
    public void PublicRoot_Null_ThrowsArgumentNullException()
    {
#pragma warning disable CA1416 // Constructor validation happens before any Windows-only behavior.
        var exception = Assert.Throws<ArgumentNullException>(
            () => new WindowsDpapiDeviceTokenStore(null!));
#pragma warning restore CA1416

        Assert.Equal("rootDirectory", exception.ParamName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void PublicRoot_Blank_ThrowsArgumentException(string rootDirectory)
    {
#pragma warning disable CA1416 // Constructor validation happens before any Windows-only behavior.
        var exception = Assert.Throws<ArgumentException>(
            () => new WindowsDpapiDeviceTokenStore(rootDirectory));
#pragma warning restore CA1416

        Assert.Equal("rootDirectory", exception.ParamName);
    }

    [Fact]
    public void Windows_FreshInstanceLoad_RoundTripsCurrentUserProtectedTokenWithoutPlaintext()
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
        var restartedStore = new WindowsDpapiDeviceTokenStore(_rootDirectory);
        var loaded = restartedStore.Load();

        Assert.Equal(DeviceTokenSaveStatus.Saved, saved.Status);
        Assert.True(saved.IsSuccess);
        Assert.Equal(DeviceTokenLoadStatus.Available, loaded.Status);
        Assert.True(loaded.HasToken);
        Assert.NotNull(loaded.Token);
        Assert.Equal("[redacted device token]", loaded.Token.ToString());
        Assert.DoesNotContain(TestTokenText, loaded.ToString(), StringComparison.Ordinal);

        var expectedBytes = expectedToken.EncodeUtf8();
        var actualBytes = loaded.Token.EncodeUtf8();
        var persistedBytes = File.ReadAllBytes(restartedStore.TokenPath);
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

    [Fact]
    public void Windows_EmptyCredentialDocument_ReturnsUnreadable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
#pragma warning restore CA1416
        Directory.CreateDirectory(_rootDirectory);
        File.WriteAllBytes(store.TokenPath, []);

        var load = store.Load();

        Assert.Equal(DeviceTokenLoadStatus.Unreadable, load.Status);
        Assert.True(File.Exists(store.TokenPath));
    }

    [Fact]
    public void Windows_OversizedCredentialDocument_ReturnsUnreadable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
#pragma warning restore CA1416
        Directory.CreateDirectory(_rootDirectory);
        File.WriteAllBytes(store.TokenPath, new byte[(64 * 1024) + 9]);

        var load = store.Load();

        Assert.Equal(DeviceTokenLoadStatus.Unreadable, load.Status);
        Assert.True(File.Exists(store.TokenPath));
    }

    [Fact]
    public void Windows_UnsupportedCredentialDocument_ReturnsUnreadable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
#pragma warning restore CA1416
        Directory.CreateDirectory(_rootDirectory);
        File.WriteAllBytes(store.TokenPath, "TPLR\x02\x00\x00\x00not-a-dpapi-payload"u8.ToArray());

        var load = store.Load();

        Assert.Equal(DeviceTokenLoadStatus.Unreadable, load.Status);
        Assert.True(File.Exists(store.TokenPath));
    }

    [Fact]
    public void Windows_FailedReplacement_PreservesExistingCredential()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(_rootDirectory);
#pragma warning restore CA1416
        Assert.True(DeviceToken.TryCreate(TestTokenText, out var originalToken, out _));
        Assert.True(DeviceToken.TryCreate("replacement-device-token", out var replacementToken, out _));
        Assert.NotNull(originalToken);
        Assert.NotNull(replacementToken);
        Assert.Equal(DeviceTokenSaveStatus.Saved, store.Save(originalToken).Status);

        using (var heldFile = new FileStream(store.TokenPath, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var replacement = store.Save(replacementToken);
            Assert.Equal(DeviceTokenSaveStatus.StorageUnavailable, replacement.Status);
        }

        var restartedStore = new WindowsDpapiDeviceTokenStore(_rootDirectory);
        var loaded = restartedStore.Load();
        Assert.Equal(DeviceTokenLoadStatus.Available, loaded.Status);
        Assert.NotNull(loaded.Token);

        var expectedBytes = originalToken.EncodeUtf8();
        var actualBytes = loaded.Token.EncodeUtf8();
        try
        {
            Assert.Equal(expectedBytes, actualBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(expectedBytes);
            CryptographicOperations.ZeroMemory(actualBytes);
        }
    }

    [Fact]
    public void Windows_InaccessibleRoot_ReturnsStorageUnavailable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var rootFile = Path.Combine(_rootDirectory, "not-a-directory");
        Directory.CreateDirectory(_rootDirectory);
        File.WriteAllText(rootFile, "not a directory");
#pragma warning disable CA1416 // The runtime guard above makes this Windows-only test safe.
        var store = new WindowsDpapiDeviceTokenStore(rootFile);
#pragma warning restore CA1416
        Assert.True(DeviceToken.TryCreate(TestTokenText, out var token, out _));
        Assert.NotNull(token);

        var save = store.Save(token);

        Assert.Equal(DeviceTokenSaveStatus.StorageUnavailable, save.Status);
        Assert.True(File.Exists(rootFile));
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootDirectory))
        {
            Directory.Delete(_rootDirectory, recursive: true);
        }
    }
}
