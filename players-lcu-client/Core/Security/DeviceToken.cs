using System;
using System.Text;

namespace players_lcu_client.Core.Security;

/// <summary>
/// An opaque, validated relay device token. Its value is deliberately not exposed publicly and
/// its string representation is always redacted.
/// </summary>
public sealed class DeviceToken
{
    /// <summary>
    /// The maximum UTF-8 byte length accepted for a device token. This is comfortably below
    /// common HTTP header limits while bounding memory and protected-file size.
    /// </summary>
    public const int MaximumUtf8Bytes = 4 * 1024;

    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);

    private readonly string _value;

    private DeviceToken(string value)
    {
        _value = value;
    }

    /// <summary>Gets the UTF-8 byte length without revealing the token text.</summary>
    public int Utf8ByteLength => StrictUtf8.GetByteCount(_value);

    /// <summary>
    /// Validates opaque token text before it reaches protected storage. The token is retained
    /// exactly as supplied; callers must not trim or normalize a credential.
    /// </summary>
    public static bool TryCreate(
        string? value,
        out DeviceToken? token,
        out DeviceTokenValidationError error)
    {
        token = null;

        if (string.IsNullOrWhiteSpace(value))
        {
            error = DeviceTokenValidationError.Missing;
            return false;
        }

        try
        {
            if (StrictUtf8.GetByteCount(value) > MaximumUtf8Bytes)
            {
                error = DeviceTokenValidationError.TooLarge;
                return false;
            }
        }
        catch (EncoderFallbackException)
        {
            error = DeviceTokenValidationError.InvalidEncoding;
            return false;
        }

        token = new DeviceToken(value);
        error = DeviceTokenValidationError.None;
        return true;
    }

    /// <inheritdoc />
    public override string ToString() => "[redacted device token]";

    /// <summary>
    /// Encodes the token for a cryptographic operation. The caller owns the returned buffer and
    /// must clear it promptly with <c>CryptographicOperations.ZeroMemory</c>.
    /// </summary>
    internal byte[] EncodeUtf8() => StrictUtf8.GetBytes(_value);

    /// <summary>
    /// Creates a token from decrypted strict UTF-8 bytes. It is intentionally internal so token
    /// text cannot be extracted through a public serialization or presentation API.
    /// </summary>
    internal static bool TryCreateFromUtf8(
        ReadOnlySpan<byte> utf8,
        out DeviceToken? token,
        out DeviceTokenValidationError error)
    {
        token = null;

        if (utf8.IsEmpty)
        {
            error = DeviceTokenValidationError.Missing;
            return false;
        }

        string value;
        try
        {
            value = StrictUtf8.GetString(utf8);
        }
        catch (DecoderFallbackException)
        {
            error = DeviceTokenValidationError.InvalidEncoding;
            return false;
        }

        return TryCreate(value, out token, out error);
    }
}
