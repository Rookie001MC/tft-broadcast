using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Lcu;

namespace players_lcu_client.Infrastructure.Storage;

/// <summary>
/// A small, crash-safe capture spool used during the live rehearsal. Each capture is written
/// as an immutable directory before it is visible to subsequent starts of the application.
/// A later SQLite delivery queue can import these directories without changing the LCU boundary.
/// </summary>
public sealed class FileTftEogCaptureStore : ITftEogCaptureStore
{
    private const int MaximumCaptureCount = 1_000;
    private const int MaximumPayloadBytes = 4 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly object _gate = new();
    private readonly string _rootDirectory;
    private readonly string _captureDirectory;
    private readonly string _stagingDirectory;
    private readonly HashSet<string> _deduplicationKeys = new(StringComparer.Ordinal);
    private CaptureSpoolStatus _currentStatus = CaptureSpoolStatus.NotStarted;
    private bool _isInitialized;

    public FileTftEogCaptureStore()
        : this(GetDefaultRootDirectory())
    {
    }

    internal FileTftEogCaptureStore(string rootDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        _rootDirectory = Path.GetFullPath(rootDirectory);
        _captureDirectory = Path.Combine(_rootDirectory, "captures");
        _stagingDirectory = Path.Combine(_rootDirectory, "staging");
    }

    public CaptureSpoolStatus CurrentStatus
    {
        get
        {
            lock (_gate)
            {
                return _currentStatus;
            }
        }
    }

    public event Action<CaptureSpoolStatus>? StatusChanged;

    public void Initialize()
    {
        CaptureSpoolStatus? changedStatus = null;

        lock (_gate)
        {
            if (_isInitialized)
            {
                return;
            }

            try
            {
                Directory.CreateDirectory(_captureDirectory);
                Directory.CreateDirectory(_stagingDirectory);
                LoadExistingCaptures();
                _isInitialized = true;
                changedStatus = new CaptureSpoolStatus(
                    _deduplicationKeys.Count,
                    _currentStatus.LastCapturedAtUtc,
                    _deduplicationKeys.Count == 0
                        ? "Waiting for a TFT end-of-game result."
                        : $"{_deduplicationKeys.Count} local result(s) are safely spooled.");
                _currentStatus = changedStatus;
            }
            catch (Exception exception) when (IsExpectedStorageException(exception))
            {
                changedStatus = new CaptureSpoolStatus(
                    _deduplicationKeys.Count,
                    _currentStatus.LastCapturedAtUtc,
                    $"Local capture storage is unavailable ({exception.GetType().Name}).");
                _currentStatus = changedStatus;
            }
        }

        if (changedStatus is not null)
        {
            RaiseStatusChanged(changedStatus);
        }
    }

    public CaptureStoreResult Persist(LcuTftEogStatsCaptured capture)
    {
        CaptureSpoolStatus? changedStatus = null;
        CaptureStoreResult result;

        lock (_gate)
        {
            if (!_isInitialized)
            {
                InitializeInsideGate();
            }

            if (capture.Utf8Json.IsEmpty || capture.Utf8Json.Length > MaximumPayloadBytes)
            {
                result = UpdateFailure("The captured TFT result exceeds the local storage limit.");
                changedStatus = _currentStatus;
            }
            else
            {
                var payloadHash = Convert.ToHexString(SHA256.HashData(capture.Utf8Json.Span)).ToLowerInvariant();
                var deduplicationKey = string.Concat(capture.GameId, "\n", payloadHash);

                if (_deduplicationKeys.Contains(deduplicationKey))
                {
                    result = new CaptureStoreResult(
                        IsStored: false,
                        IsDuplicate: true,
                        CaptureId: null,
                        "This exact TFT result is already in the local spool.");
                }
                else if (_deduplicationKeys.Count >= MaximumCaptureCount)
                {
                    result = UpdateFailure("The local capture spool is full. Existing results were preserved.");
                    changedStatus = _currentStatus;
                }
                else
                {
                    var captureId = Guid.NewGuid();
                    var stagingCaptureDirectory = Path.Combine(_stagingDirectory, captureId.ToString("N"));
                    var finalCaptureDirectory = Path.Combine(_captureDirectory, captureId.ToString("N"));

                    try
                    {
                        Directory.CreateDirectory(stagingCaptureDirectory);
                        WriteDurableFile(
                            Path.Combine(stagingCaptureDirectory, "payload.json"),
                            capture.Utf8Json.Span);

                        var manifest = new CaptureManifest(
                            captureId,
                            capture.GameId,
                            capture.ObservedAtUtc,
                            capture.Source.ToString(),
                            payloadHash,
                            capture.Utf8Json.Length);
                        WriteDurableFile(
                            Path.Combine(stagingCaptureDirectory, "capture.json"),
                            JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions));

                        Directory.Move(stagingCaptureDirectory, finalCaptureDirectory);
                        _deduplicationKeys.Add(deduplicationKey);
                        changedStatus = new CaptureSpoolStatus(
                            _deduplicationKeys.Count,
                            capture.ObservedAtUtc,
                            $"Saved TFT result locally at {capture.ObservedAtUtc.ToLocalTime():t}.");
                        _currentStatus = changedStatus;
                        result = new CaptureStoreResult(
                            IsStored: true,
                            IsDuplicate: false,
                            CaptureId: captureId,
                            "TFT result saved locally.");
                    }
                    catch (Exception exception) when (IsExpectedStorageException(exception))
                    {
                        result = UpdateFailure($"Could not save the TFT result ({exception.GetType().Name}).");
                        changedStatus = _currentStatus;
                    }
                }
            }
        }

        if (changedStatus is not null)
        {
            RaiseStatusChanged(changedStatus);
        }

        return result;
    }

    private void InitializeInsideGate()
    {
        try
        {
            Directory.CreateDirectory(_captureDirectory);
            Directory.CreateDirectory(_stagingDirectory);
            LoadExistingCaptures();
            _isInitialized = true;
            _currentStatus = new CaptureSpoolStatus(
                _deduplicationKeys.Count,
                _currentStatus.LastCapturedAtUtc,
                "Waiting for a TFT end-of-game result.");
        }
        catch (Exception exception) when (IsExpectedStorageException(exception))
        {
            _currentStatus = new CaptureSpoolStatus(
                _deduplicationKeys.Count,
                _currentStatus.LastCapturedAtUtc,
                $"Local capture storage is unavailable ({exception.GetType().Name}).");
        }
    }

    private void LoadExistingCaptures()
    {
        foreach (var manifestPath in Directory.EnumerateFiles(
                     _captureDirectory,
                     "capture.json",
                     SearchOption.AllDirectories))
        {
            try
            {
                var manifest = JsonSerializer.Deserialize<CaptureManifest>(File.ReadAllBytes(manifestPath), JsonOptions);
                if (manifest is null ||
                    manifest.CaptureId == Guid.Empty ||
                    string.IsNullOrWhiteSpace(manifest.GameId) ||
                    string.IsNullOrWhiteSpace(manifest.PayloadSha256))
                {
                    continue;
                }

                _deduplicationKeys.Add(string.Concat(manifest.GameId, "\n", manifest.PayloadSha256));
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
            {
                // A damaged or incomplete capture never blocks later captures. It remains in
                // place for manual recovery and is not treated as a successful stored result.
            }
        }
    }

    private CaptureStoreResult UpdateFailure(string detail)
    {
        _currentStatus = new CaptureSpoolStatus(
            _deduplicationKeys.Count,
            _currentStatus.LastCapturedAtUtc,
            detail);
        return new CaptureStoreResult(false, false, null, detail);
    }

    private static void WriteDurableFile(string path, ReadOnlySpan<byte> contents)
    {
        using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 32 * 1024,
            FileOptions.WriteThrough);
        stream.Write(contents);
        stream.Flush(flushToDisk: true);
    }

    private static bool IsExpectedStorageException(Exception exception) => exception is
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

    private void RaiseStatusChanged(CaptureSpoolStatus status)
    {
        var handlers = StatusChanged;
        if (handlers is null)
        {
            return;
        }

        foreach (Action<CaptureSpoolStatus> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(status);
            }
            catch
            {
                // A status subscriber must not prevent a result from being retained.
            }
        }
    }

    private sealed record CaptureManifest(
        Guid CaptureId,
        string GameId,
        DateTimeOffset CapturedAtUtc,
        string Source,
        string PayloadSha256,
        int PayloadBytes);
}
