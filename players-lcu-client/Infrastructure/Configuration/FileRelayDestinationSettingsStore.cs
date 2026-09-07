using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using players_lcu_client.Core.Configuration;

namespace players_lcu_client.Infrastructure.Configuration;

/// <summary>
/// Persists the selected receiver destination beneath the current user's local application-data
/// directory. The document contains only a schema version, scheme, host, and port; protected
/// credentials are intentionally outside this store.
/// </summary>
public sealed class FileRelayDestinationSettingsStore : IRelayDestinationSettingsStore
{
    private const int CurrentDocumentVersion = 1;
    private const int MaximumDocumentBytes = 4 * 1024;
    private const string DefaultFileName = "relay-destination-settings.json";
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = true,
    };

    private readonly object _gate = new();
    private readonly string _rootDirectory;
    private readonly string _settingsPath;

    /// <summary>
    /// Initializes a store at <c>%LOCALAPPDATA%/TftPlayerRelay</c>.
    /// </summary>
    public FileRelayDestinationSettingsStore()
        : this(GetDefaultRootDirectory(), DefaultFileName)
    {
    }

    /// <summary>
    /// Initializes a store rooted at a caller-supplied directory. This supports isolated tests
    /// without changing the process-wide local application-data location.
    /// </summary>
    public FileRelayDestinationSettingsStore(string rootDirectory)
        : this(rootDirectory, DefaultFileName)
    {
    }

    /// <summary>
    /// Initializes a store rooted at a caller-supplied directory and file name.
    /// </summary>
    public FileRelayDestinationSettingsStore(string rootDirectory, string fileName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);

        if (!Path.IsPathFullyQualified(rootDirectory)
            || Path.IsPathRooted(fileName)
            || fileName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
        {
            throw new ArgumentException("The settings path must use a rooted directory and a file name only.");
        }

        _rootDirectory = Path.GetFullPath(rootDirectory);
        _settingsPath = Path.Combine(_rootDirectory, fileName);
    }

    /// <summary>Gets the resolved path used for the destination document.</summary>
    public string SettingsPath => _settingsPath;

    /// <inheritdoc />
    public RelayDestinationSettingsLoadResult Load()
    {
        lock (_gate)
        {
            try
            {
                using var stream = new FileStream(
                    _settingsPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read | FileShare.Delete,
                    bufferSize: MaximumDocumentBytes,
                    FileOptions.SequentialScan);

                if (stream.Length is < 1 or > MaximumDocumentBytes)
                {
                    return RelayDestinationSettingsLoadResult.Failure(
                        RelayDestinationSettingsLoadStatus.InvalidDocument,
                        "The saved destination settings document has an invalid size.");
                }

                using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 8,
                });

                return ParseDocument(document.RootElement);
            }
            catch (FileNotFoundException)
            {
                return RelayDestinationSettingsLoadResult.NotFound();
            }
            catch (DirectoryNotFoundException)
            {
                return RelayDestinationSettingsLoadResult.NotFound();
            }
            catch (JsonException)
            {
                return InvalidDocument();
            }
            catch (Exception exception) when (IsExpectedReadException(exception))
            {
                return RelayDestinationSettingsLoadResult.Failure(
                    RelayDestinationSettingsLoadStatus.StorageUnavailable,
                    $"Could not read saved destination settings ({exception.GetType().Name}).");
            }
        }
    }

    /// <inheritdoc />
    public RelayDestinationSettingsSaveResult Save(RelayDestinationSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        lock (_gate)
        {
            string? temporaryPath = null;

            try
            {
                Directory.CreateDirectory(_rootDirectory);
                temporaryPath = Path.Combine(
                    _rootDirectory,
                    $".{DefaultFileName}.{Guid.NewGuid():N}.tmp");

                WriteDurableDocument(temporaryPath, settings);
                ReplaceAtomically(temporaryPath, _settingsPath);
                temporaryPath = null;
                return RelayDestinationSettingsSaveResult.Saved();
            }
            catch (Exception exception) when (IsExpectedWriteException(exception))
            {
                return RelayDestinationSettingsSaveResult.Failure(
                    $"Could not save destination settings ({exception.GetType().Name}).");
            }
            finally
            {
                if (temporaryPath is not null)
                {
                    TryDeleteTemporaryFile(temporaryPath);
                }
            }
        }
    }

    private static RelayDestinationSettingsLoadResult ParseDocument(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !TryGetExactProperties(root, ["version", "destination"], out var properties)
            || properties["version"].ValueKind != JsonValueKind.Number
            || !properties["version"].TryGetInt32(out var version))
        {
            return InvalidDocument();
        }

        if (version != CurrentDocumentVersion)
        {
            return RelayDestinationSettingsLoadResult.Failure(
                RelayDestinationSettingsLoadStatus.UnsupportedVersion,
                "The saved destination settings use an unsupported version.");
        }

        var destination = properties["destination"];
        if (destination.ValueKind != JsonValueKind.Object
            || !TryGetExactProperties(destination, ["scheme", "host", "port"], out var destinationProperties)
            || destinationProperties["scheme"].ValueKind != JsonValueKind.String
            || destinationProperties["host"].ValueKind != JsonValueKind.String
            || destinationProperties["port"].ValueKind != JsonValueKind.Number)
        {
            return InvalidDocument();
        }

        var scheme = destinationProperties["scheme"].GetString();
        var host = destinationProperties["host"].GetString();
        if (!destinationProperties["port"].TryGetInt32(out var port)
            || !RelayDestination.TryCreate(
                scheme,
                host,
                port.ToString(System.Globalization.CultureInfo.InvariantCulture),
                out var parsedDestination,
                out _)
            || parsedDestination is null)
        {
            return InvalidDocument();
        }

        return RelayDestinationSettingsLoadResult.Loaded(
            new RelayDestinationSettings(parsedDestination));
    }

    private static bool TryGetExactProperties(
        JsonElement element,
        string[] expectedNames,
        out Dictionary<string, JsonElement> properties)
    {
        properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);

        foreach (var property in element.EnumerateObject())
        {
            if (!properties.TryAdd(property.Name, property.Value))
            {
                return false;
            }
        }

        if (properties.Count != expectedNames.Length)
        {
            return false;
        }

        foreach (var expectedName in expectedNames)
        {
            if (!properties.ContainsKey(expectedName))
            {
                return false;
            }
        }

        return true;
    }

    private static RelayDestinationSettingsLoadResult InvalidDocument() =>
        RelayDestinationSettingsLoadResult.Failure(
            RelayDestinationSettingsLoadStatus.InvalidDocument,
            "The saved destination settings document is invalid.");

    private static void WriteDurableDocument(string path, RelayDestinationSettings settings)
    {
        using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            bufferSize: MaximumDocumentBytes,
            FileOptions.WriteThrough);
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteNumber("version", CurrentDocumentVersion);
            writer.WritePropertyName("destination");
            writer.WriteStartObject();
            writer.WriteString("scheme", ToPersistedScheme(settings.Destination.Scheme));
            writer.WriteString("host", settings.Destination.Host.Value);
            writer.WriteNumber("port", settings.Destination.Port.Value);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.Flush();
        }

        stream.Flush(flushToDisk: true);
    }

    private static string ToPersistedScheme(RelayDestinationScheme scheme) => scheme switch
    {
        RelayDestinationScheme.Http => "http",
        RelayDestinationScheme.Https => "https",
        _ => throw new ArgumentOutOfRangeException(nameof(scheme)),
    };

    private static void ReplaceAtomically(string sourcePath, string destinationPath)
    {
        if (!File.Exists(destinationPath))
        {
            try
            {
                File.Move(sourcePath, destinationPath);
                return;
            }
            catch (IOException) when (File.Exists(destinationPath))
            {
                // Another process created the document after the existence check. Replacing it
                // preserves the same atomic visibility guarantee as an ordinary update.
            }
        }

        File.Replace(sourcePath, destinationPath, destinationBackupFileName: null);
    }

    private static void TryDeleteTemporaryFile(string temporaryPath)
    {
        try
        {
            File.Delete(temporaryPath);
        }
        catch (Exception exception) when (IsExpectedWriteException(exception))
        {
            // A uniquely named, incomplete temporary file is never loaded. It is safe to leave
            // it for later manual cleanup if the local filesystem has become unavailable.
        }
    }

    private static bool IsExpectedReadException(Exception exception) => exception is
        IOException or
        UnauthorizedAccessException or
        NotSupportedException or
        ArgumentException;

    private static bool IsExpectedWriteException(Exception exception) => exception is
        IOException or
        UnauthorizedAccessException or
        NotSupportedException or
        ArgumentException;

    private static string GetDefaultRootDirectory()
    {
        var localApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localApplicationData))
        {
            throw new InvalidOperationException("The current user has no local application-data directory.");
        }

        return Path.Combine(localApplicationData, "TftPlayerRelay");
    }
}
