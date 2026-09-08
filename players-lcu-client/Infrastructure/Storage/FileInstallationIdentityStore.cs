using System;
using System.IO;
using System.Text.Json;
using players_lcu_client.Core.Delivery;

namespace players_lcu_client.Infrastructure.Storage;

/// <summary>Small atomic metadata store for the installation ID and next capture sequence.</summary>
public sealed class FileInstallationIdentityStore : IInstallationIdentityStore
{
    private readonly object _gate = new();
    private readonly string _path;

    public FileInstallationIdentityStore()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(root)) throw new InvalidOperationException("Local application data is unavailable.");
        _path = Path.Combine(root, "TftPlayerRelay", "installation.json");
    }

    public InstallationSequence ReserveNextSequence()
    {
        lock (_gate)
        {
            var document = Load();
            checked { document = document with { NextSequence = document.NextSequence + 1 }; }
            Save(document);
            return new InstallationSequence(document.InstallationId, document.NextSequence.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
    }

    private InstallationDocument Load()
    {
        if (!File.Exists(_path)) return new InstallationDocument(Guid.NewGuid(), 0);
        var value = JsonSerializer.Deserialize<InstallationDocument>(File.ReadAllText(_path));
        if (value is null || value.InstallationId == Guid.Empty || value.NextSequence < 0)
            throw new IOException("The relay installation metadata is invalid.");
        return value;
    }

    private void Save(InstallationDocument document)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporaryPath = _path + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(document));
        File.Move(temporaryPath, _path, overwrite: true);
    }

    private sealed record InstallationDocument(Guid InstallationId, long NextSequence);
}
