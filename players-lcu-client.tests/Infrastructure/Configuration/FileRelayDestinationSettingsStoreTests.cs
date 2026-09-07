using players_lcu_client.Core.Configuration;
using players_lcu_client.Infrastructure.Configuration;

namespace players_lcu_client.tests.Infrastructure.Configuration;

public sealed class FileRelayDestinationSettingsStoreTests : IDisposable
{
    private readonly string _rootDirectory = Path.Combine(Path.GetTempPath(), $"TftPlayerRelayTests-{Guid.NewGuid():N}");

    [Fact]
    public void SaveThenLoad_RoundTripsOnlyValidatedNonSecretDestination()
    {
        var store = new FileRelayDestinationSettingsStore(_rootDirectory);
        Assert.True(RelayDestination.TryCreate(
            "https",
            "relay.example.test",
            "8443",
            out var destination,
            out _));
        Assert.NotNull(destination);

        var save = store.Save(new RelayDestinationSettings(destination));
        var load = store.Load();

        Assert.True(save.IsSuccess);
        Assert.Equal(RelayDestinationSettingsLoadStatus.Loaded, load.Status);
        Assert.Equal("https://relay.example.test:8443/", load.Settings?.Destination.ToString());
        var savedDocument = File.ReadAllText(store.SettingsPath);
        Assert.DoesNotContain("token", savedDocument, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("credential", savedDocument, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Load_RejectsExtraCredentialLikeFieldWithoutReplacingTheDocument()
    {
        Directory.CreateDirectory(_rootDirectory);
        var store = new FileRelayDestinationSettingsStore(_rootDirectory);
        const string document = """
            {"version":1,"destination":{"scheme":"http","host":"127.0.0.1","port":5173},"token":"must-not-be-here"}
            """;
        File.WriteAllText(store.SettingsPath, document);

        var load = store.Load();

        Assert.Equal(RelayDestinationSettingsLoadStatus.InvalidDocument, load.Status);
        Assert.Equal(document, File.ReadAllText(store.SettingsPath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootDirectory))
        {
            Directory.Delete(_rootDirectory, recursive: true);
        }
    }
}
