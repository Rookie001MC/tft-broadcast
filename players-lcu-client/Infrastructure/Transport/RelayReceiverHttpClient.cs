using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using players_lcu_client.Core.Configuration;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Core.Security;

namespace players_lcu_client.Infrastructure.Transport;

public interface IRelayReceiverClient
{
    Task<RelayConnectionProbe> TestConnectionAsync(
        RelayDestination destination,
        DeviceToken token,
        CancellationToken cancellationToken);

    Task<DeliveryAttemptCompletion> DeliverAsync(
        CaptureEnvelope envelope,
        RelayDestination destination,
        DeviceToken token,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken);
}

/// <summary>A safe operator-facing result of probing the receiver handshake.</summary>
public sealed record RelayConnectionProbe(bool IsConnected, string Detail);

/// <summary>Strict v1 HTTP delivery client. It accepts only a correlated durable receipt.</summary>
public sealed class RelayReceiverHttpClient : IRelayReceiverClient, IDisposable
{
    private const int MaximumResponseBytes = 64 * 1024;
    private readonly HttpClient _httpClient;

    public RelayReceiverHttpClient()
    {
        _httpClient = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(10),
        };
    }

    public async Task<RelayConnectionProbe> TestConnectionAsync(
        RelayDestination destination,
        DeviceToken token,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(token);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, destination.BuildEndpointUri("/api/player-relay/v1/handshake"));
            ApplyAuthorization(request, token);
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                return new RelayConnectionProbe(false, "Receiver rejected the device token.");
            }
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return new RelayConnectionProbe(false, "Relay handshake endpoint was not found.");
            }
            if (response.StatusCode != HttpStatusCode.OK)
            {
                return new RelayConnectionProbe(false, $"Relay returned HTTP {(int)response.StatusCode}.");
            }

            return await HasValidHandshakeAsync(response, cancellationToken).ConfigureAwait(false)
                ? new RelayConnectionProbe(true, "Connected to the relay receiver.")
                : new RelayConnectionProbe(false, "Relay responded with an unsupported handshake.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new RelayConnectionProbe(false, "Connection test timed out.");
        }
        catch (HttpRequestException)
        {
            return new RelayConnectionProbe(false, "Relay could not be reached.");
        }
        catch (JsonException)
        {
            return new RelayConnectionProbe(false, "Relay returned an invalid handshake.");
        }
    }

    public async Task<DeliveryAttemptCompletion> DeliverAsync(
        CaptureEnvelope envelope,
        RelayDestination destination,
        DeviceToken token,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(token);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, destination.BuildEndpointUri("/api/player-relay/v1/captures"));
            ApplyAuthorization(request, token);

            request.Headers.Add("Idempotency-Key", envelope.CaptureId.ToString("D"));
            request.Content = JsonContent.Create(new
            {
                protocolVersion = envelope.ProtocolVersion,
                captureId = envelope.CaptureId,
                installationId = envelope.InstallationId,
                sequence = envelope.Sequence,
                capturedAt = envelope.CapturedAtUtc,
                appVersion = envelope.AppVersion,
                observationKind = envelope.ObservationKind == DeliveryObservationKind.Event ? "event" : "recovery",
                sourcePlatform = envelope.SourcePlatform,
                gameId = envelope.GameId,
                localPlayer = new { puuid = envelope.LocalPlayer.Puuid, gameName = envelope.LocalPlayer.GameName, tagLine = envelope.LocalPlayer.TagLine },
                context = envelope.Context is null ? null : new { serverId = envelope.Context.ServerId, eventId = envelope.Context.EventId },
                payloadSha256 = envelope.PayloadSha256,
                payloadJson = envelope.PayloadJson,
            });
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

            if (response.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK)
            {
                var acknowledgment = await TryReadAcknowledgmentAsync(response, envelope.CaptureId, cancellationToken).ConfigureAwait(false);
                return acknowledgment is null
                    ? DeliveryAttemptCompletion.Blocked("invalid_acknowledgment")
                    : DeliveryAttemptCompletion.Acknowledged(acknowledgment);
            }

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return DeliveryAttemptCompletion.Blocked("authentication_required");
            if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict or HttpStatusCode.RequestEntityTooLarge or HttpStatusCode.UnprocessableEntity)
                return DeliveryAttemptCompletion.Rejected("receiver_rejected");
            if ((int)response.StatusCode is >= 300 and < 400)
                return DeliveryAttemptCompletion.Blocked("redirect_not_allowed");
            if (response.StatusCode == HttpStatusCode.NotFound)
                return DeliveryAttemptCompletion.Blocked("endpoint_not_found");
            if (response.StatusCode == HttpStatusCode.RequestTimeout || response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500)
                return DeliveryAttemptCompletion.Retry("receiver_unavailable", RetryAt(response, nowUtc));

            return DeliveryAttemptCompletion.Blocked("unexpected_response");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return DeliveryAttemptCompletion.Retry("request_timeout", nowUtc.AddSeconds(5));
        }
        catch (HttpRequestException)
        {
            return DeliveryAttemptCompletion.Retry("network_unavailable", nowUtc.AddSeconds(5));
        }
    }

    public void Dispose() => _httpClient.Dispose();

    private static void ApplyAuthorization(HttpRequestMessage request, DeviceToken token)
    {
        var tokenBytes = token.EncodeUtf8();
        try
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Encoding.UTF8.GetString(tokenBytes));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(tokenBytes);
        }
    }

    private static DateTimeOffset RetryAt(HttpResponseMessage response, DateTimeOffset nowUtc)
    {
        var retryAfter = response.Headers.RetryAfter;
        var proposed = retryAfter?.Date ?? (retryAfter?.Delta is { } delay ? nowUtc.Add(delay) : nowUtc.AddSeconds(5));
        if (proposed <= nowUtc) proposed = nowUtc.AddSeconds(1);
        return proposed > nowUtc.AddMinutes(5) ? nowUtc.AddMinutes(5) : proposed;
    }

    private static async Task<DeliveryAcknowledgment?> TryReadAcknowledgmentAsync(
        HttpResponseMessage response,
        Guid expectedCaptureId,
        CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[8 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (buffer.Length > MaximumResponseBytes - read) return null;
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }
        using var document = JsonDocument.Parse(buffer.ToArray());
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("captureId", out var captureIdValue) || !Guid.TryParse(captureIdValue.GetString(), out var captureId) || captureId != expectedCaptureId ||
            !root.TryGetProperty("status", out var statusValue) ||
            !root.TryGetProperty("receivedAt", out var receivedAtValue) || !DateTimeOffset.TryParse(receivedAtValue.GetString(), out var receivedAt))
            return null;
        return statusValue.GetString() switch
        {
            "stored" => new DeliveryAcknowledgment(captureId, DeliveryAcknowledgmentStatus.Stored, receivedAt),
            "duplicate" => new DeliveryAcknowledgment(captureId, DeliveryAcknowledgmentStatus.Duplicate, receivedAt),
            _ => null,
        };
    }

    private static async Task<bool> HasValidHandshakeAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[8 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (buffer.Length > MaximumResponseBytes - read) return false;
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        using var document = JsonDocument.Parse(buffer.ToArray());
        var root = document.RootElement;
        return root.ValueKind == JsonValueKind.Object &&
               root.TryGetProperty("protocolVersion", out var protocolVersion) && protocolVersion.TryGetInt32(out var version) && version == 1 &&
               root.TryGetProperty("serverId", out var serverId) && serverId.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(serverId.GetString()) &&
               root.TryGetProperty("eventId", out var eventId) && eventId.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(eventId.GetString()) &&
               root.TryGetProperty("maxPayloadBytes", out var maximumPayloadBytes) && maximumPayloadBytes.TryGetInt32(out var bytes) && bytes is > 0 and <= 4 * 1024 * 1024;
    }
}
