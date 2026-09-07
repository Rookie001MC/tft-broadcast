using System;
using System.IO;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using players_lcu_client.Core.Security;

namespace players_lcu_client.Infrastructure.Security;

/// <summary>
/// Stores a relay device token in a versioned file protected by Windows DPAPI for the current
/// user. The store intentionally has no plaintext fallback and never logs credential failures.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsDpapiDeviceTokenStore : IDeviceTokenStore
{
    private const string DefaultFileName = "device-token.dat";
    private const int FormatVersion = 1;
    private const int HeaderLength = 8;
    private const int MaximumProtectedBytes = 64 * 1024;
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("TPLR");
    private static readonly byte[] PurposeEntropy = Encoding.UTF8.GetBytes("TftPlayerRelay.DeviceToken/v1");

    private readonly object _gate = new();
    private readonly string _rootDirectory;
    private readonly string _tokenPath;

    /// <summary>
    /// Initializes a store at <c>%LOCALAPPDATA%/TftPlayerRelay/device-token.dat</c>.
    /// </summary>
    public WindowsDpapiDeviceTokenStore()
        : this(GetDefaultRootDirectory(), DefaultFileName)
    {
    }

    /// <summary>
    /// Initializes a store at a caller-supplied root directory. This supports isolated tests
    /// without changing the process-wide local application-data location.
    /// </summary>
    public WindowsDpapiDeviceTokenStore(string rootDirectory)
        : this(rootDirectory, DefaultFileName)
    {
    }

    internal WindowsDpapiDeviceTokenStore(string rootDirectory, string fileName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);

        if (!Path.IsPathFullyQualified(rootDirectory)
            || Path.IsPathRooted(fileName)
            || fileName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
        {
            throw new ArgumentException("The credential path must use a rooted directory and a file name only.");
        }

        _rootDirectory = Path.GetFullPath(rootDirectory);
        _tokenPath = Path.Combine(_rootDirectory, fileName);
    }

    /// <summary>Gets the resolved path containing only DPAPI-protected credential data.</summary>
    public string TokenPath => _tokenPath;

    /// <inheritdoc />
    public DeviceTokenLoadResult Load()
    {
        if (!OperatingSystem.IsWindows())
        {
            return DeviceTokenLoadResult.Unavailable();
        }

        lock (_gate)
        {
            byte[]? document = null;
            byte[]? protectedToken = null;
            byte[]? plaintextToken = null;

            try
            {
                document = ReadBoundedDocument();
                if (!TryExtractProtectedToken(document, out protectedToken)
                    || protectedToken is null)
                {
                    return DeviceTokenLoadResult.Unreadable();
                }

                plaintextToken = ProtectedData.Unprotect(
                    protectedToken,
                    PurposeEntropy,
                    DataProtectionScope.CurrentUser);

                if (!DeviceToken.TryCreateFromUtf8(plaintextToken, out var token, out _)
                    || token is null)
                {
                    return DeviceTokenLoadResult.Unreadable();
                }

                return DeviceTokenLoadResult.Available(token);
            }
            catch (FileNotFoundException)
            {
                return DeviceTokenLoadResult.NotFound();
            }
            catch (DirectoryNotFoundException)
            {
                return DeviceTokenLoadResult.NotFound();
            }
            catch (CryptographicException)
            {
                return DeviceTokenLoadResult.Unreadable();
            }
            catch (PlatformNotSupportedException)
            {
                return DeviceTokenLoadResult.Unavailable();
            }
            catch (Exception exception) when (IsExpectedReadException(exception))
            {
                return DeviceTokenLoadResult.StorageUnavailable();
            }
            finally
            {
                Zero(document);
                Zero(protectedToken);
                Zero(plaintextToken);
            }
        }
    }

    /// <inheritdoc />
    public DeviceTokenSaveResult Save(DeviceToken token)
    {
        ArgumentNullException.ThrowIfNull(token);

        if (!OperatingSystem.IsWindows())
        {
            return DeviceTokenSaveResult.Unavailable();
        }

        lock (_gate)
        {
            byte[]? plaintextToken = null;
            byte[]? protectedToken = null;
            string? temporaryPath = null;

            try
            {
                plaintextToken = token.EncodeUtf8();
                protectedToken = ProtectedData.Protect(
                    plaintextToken,
                    PurposeEntropy,
                    DataProtectionScope.CurrentUser);

                if (protectedToken.Length is < 1 or > MaximumProtectedBytes)
                {
                    return DeviceTokenSaveResult.StorageUnavailable();
                }

                Directory.CreateDirectory(_rootDirectory);
                temporaryPath = Path.Combine(
                    _rootDirectory,
                    $".{Path.GetFileName(_tokenPath)}.{Guid.NewGuid():N}.tmp");
                WriteDurableDocument(temporaryPath, protectedToken);
                ReplaceAtomically(temporaryPath, _tokenPath);
                temporaryPath = null;
                return DeviceTokenSaveResult.Saved();
            }
            catch (CryptographicException)
            {
                return DeviceTokenSaveResult.Unavailable();
            }
            catch (PlatformNotSupportedException)
            {
                return DeviceTokenSaveResult.Unavailable();
            }
            catch (Exception exception) when (IsExpectedWriteException(exception))
            {
                return DeviceTokenSaveResult.StorageUnavailable();
            }
            finally
            {
                if (temporaryPath is not null)
                {
                    TryDeleteTemporaryFile(temporaryPath);
                }

                Zero(plaintextToken);
                Zero(protectedToken);
            }
        }
    }

    private byte[] ReadBoundedDocument()
    {
        using var stream = new FileStream(
            _tokenPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read | FileShare.Delete,
            bufferSize: MaximumProtectedBytes + HeaderLength,
            FileOptions.SequentialScan);

        if (stream.Length is < HeaderLength + 1 or > MaximumProtectedBytes + HeaderLength)
        {
            throw new InvalidDataException("The protected credential document has an invalid size.");
        }

        var document = new byte[checked((int)stream.Length)];
        stream.ReadExactly(document);
        return document;
    }

    private static bool TryExtractProtectedToken(byte[] document, out byte[]? protectedToken)
    {
        protectedToken = null;

        if (document.Length is < HeaderLength + 1 or > MaximumProtectedBytes + HeaderLength
            || !document.AsSpan(0, Magic.Length).SequenceEqual(Magic)
            || document[4] != FormatVersion
            || document[5] != 0
            || document[6] != 0
            || document[7] != 0)
        {
            return false;
        }

        protectedToken = document.AsSpan(HeaderLength).ToArray();
        return true;
    }

    private static void WriteDurableDocument(string path, ReadOnlySpan<byte> protectedToken)
    {
        using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            bufferSize: MaximumProtectedBytes + HeaderLength,
            FileOptions.WriteThrough);
        stream.Write(Magic);
        stream.WriteByte(FormatVersion);
        stream.WriteByte(0);
        stream.WriteByte(0);
        stream.WriteByte(0);
        stream.Write(protectedToken);
        stream.Flush(flushToDisk: true);
    }

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
                // A concurrent process created the file after the existence check. Replacing it
                // maintains atomic visibility for the explicit save operation.
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
            // The temporary file contains DPAPI ciphertext only. It is never loaded and must not
            // replace an existing credential if cleanup is unavailable.
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

    private static void Zero(byte[]? buffer)
    {
        if (buffer is not null)
        {
            CryptographicOperations.ZeroMemory(buffer);
        }
    }
}
