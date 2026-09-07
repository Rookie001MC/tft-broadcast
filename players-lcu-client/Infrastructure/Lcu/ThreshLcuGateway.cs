using System;
using System.Buffers;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using players_lcu_client.Core.Lcu;
using Thresh.Abstractions;

namespace players_lcu_client.Infrastructure.Lcu;

/// <summary>
/// Exploratory, read-only LCU gateway backed by Thresh.
/// </summary>
/// <remarks>
/// This class never logs, persists, emits, or uploads LCU credentials or EOG payloads. It is
/// intentionally limited to connection discovery and safe lifecycle observations until the
/// planned capture coordinator is introduced after a real Windows rehearsal.
/// </remarks>
public sealed class ThreshLcuGateway : ILcuGateway
{
    private const string GameflowPhasePath = "/lol-gameflow/v1/gameflow-phase";
    private const string TftEogStatsPath = "/lol-end-of-game/v1/tft-eog-stats";
    private const int MaxEogPayloadBytes = 4 * 1024 * 1024;
    private const int ReadBufferBytes = 32 * 1024;
    private static readonly TimeSpan ConnectWaitTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan DiscoveryRetryDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ConnectedMonitorDelay = TimeSpan.FromSeconds(1);

    private readonly object _sync = new();
    private readonly ILcuHttpClient _lcuHttpClient;
    private readonly IEventStream _eventStream;
    private readonly ILogger<ThreshLcuGateway> _logger;
    private readonly SemaphoreSlim _eogReadGate = new(initialCount: 1, maxCount: 1);

    private CancellationTokenSource? _lifetimeCancellation;
    private Task? _monitorTask;
    private Task? _eogReadTask;
    private IDisposable? _gameflowSubscription;
    private IDisposable? _tftEogSubscription;
    private bool _eogRescanRequested;
    private LcuObservationSource _eogRescanSource;
    private LcuGatewayStatus _currentStatus = CreateStoppedStatus();
    private bool _disposed;

    /// <summary>
    /// Creates a read-only gateway. Thresh supplies lockfile discovery, loopback authentication,
    /// and LCU certificate handling through the injected dependencies.
    /// </summary>
    public ThreshLcuGateway(
        ILcuHttpClient lcuHttpClient,
        IEventStream eventStream,
        ILogger<ThreshLcuGateway> logger)
    {
        _lcuHttpClient = lcuHttpClient ?? throw new ArgumentNullException(nameof(lcuHttpClient));
        _eventStream = eventStream ?? throw new ArgumentNullException(nameof(eventStream));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc />
    public LcuGatewayStatus CurrentStatus
    {
        get
        {
            lock (_sync)
            {
                return _currentStatus;
            }
        }
    }

    /// <inheritdoc />
    public event Action<LcuGatewayStatus>? StatusChanged;

    /// <inheritdoc />
    public event Action<LcuGameflowPhaseChanged>? GameflowPhaseChanged;

    /// <inheritdoc />
    public event Action<LcuTftEogStatsObserved>? TftEogStatsObserved;

    /// <inheritdoc />
    public event Action<LcuTftEogStatsCaptured>? TftEogStatsCaptured;

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        lock (_sync)
        {
            ThrowIfDisposed();

            if (_monitorTask is { IsCompleted: false })
            {
                return Task.CompletedTask;
            }

            _lifetimeCancellation?.Dispose();
            var lifetimeCancellation = new CancellationTokenSource();
            _lifetimeCancellation = lifetimeCancellation;
            _monitorTask = Task.Run(
                () => MonitorAsync(lifetimeCancellation.Token),
                CancellationToken.None);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        CancellationTokenSource? lifetimeCancellation;
        Task? monitorTask;
        Task? eogReadTask;
        IDisposable? gameflowSubscription;
        IDisposable? tftEogSubscription;

        lock (_sync)
        {
            lifetimeCancellation = _lifetimeCancellation;
            monitorTask = _monitorTask;
            eogReadTask = _eogReadTask;
            gameflowSubscription = _gameflowSubscription;
            tftEogSubscription = _tftEogSubscription;
            _gameflowSubscription = null;
            _tftEogSubscription = null;
            _eogRescanRequested = false;
        }

        if (lifetimeCancellation is null)
        {
            SetConnectionState(LcuGatewayConnectionState.Stopped, "LCU observation is stopped.");
            return;
        }

        lifetimeCancellation.Cancel();
        gameflowSubscription?.Dispose();
        tftEogSubscription?.Dispose();

        var tasks = new[] { monitorTask, eogReadTask };
        foreach (var task in tasks)
        {
            if (task is not null)
            {
                await task.WaitAsync(cancellationToken).ConfigureAwait(false);
            }
        }

        lock (_sync)
        {
            if (ReferenceEquals(_lifetimeCancellation, lifetimeCancellation))
            {
                _lifetimeCancellation = null;
                _monitorTask = null;
                _eogReadTask = null;
            }
        }

        lifetimeCancellation.Dispose();
        SetConnectionState(LcuGatewayConnectionState.Stopped, "LCU observation is stopped.");
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        await StopAsync(CancellationToken.None).ConfigureAwait(false);
        _eogReadGate.Dispose();
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private async Task MonitorAsync(CancellationToken cancellationToken)
    {
        var previouslyConnected = false;

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (_eventStream.IsConnected)
                {
                    if (!previouslyConnected)
                    {
                        previouslyConnected = true;
                        await ObserveConnectedClientAsync(cancellationToken).ConfigureAwait(false);
                    }

                    await Task.Delay(ConnectedMonitorDelay, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                SetConnectionState(
                    previouslyConnected
                        ? LcuGatewayConnectionState.Reconnecting
                        : LcuGatewayConnectionState.Searching,
                    previouslyConnected
                        ? "The League Client connection was lost; reconnecting."
                        : "Searching for the local League Client.");

                previouslyConnected = false;
                SetConnectionState(LcuGatewayConnectionState.Connecting, "Connecting to the local League Client.");

                try
                {
                    var connected = await _eventStream
                        .ConnectAndWaitAsync(ConnectWaitTimeout, cancellationToken)
                        .ConfigureAwait(false);

                    if (!connected)
                    {
                        SetConnectionState(
                            LcuGatewayConnectionState.Searching,
                            "The local League Client is not ready yet; retrying discovery.");
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    LogSafeDebug("LCU discovery did not complete", exception);
                    SetConnectionState(
                        LcuGatewayConnectionState.Searching,
                        "The local League Client is unavailable; retrying discovery.");
                }

                await Task.Delay(DiscoveryRetryDelay, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        catch (Exception exception)
        {
            LogSafeDebug("LCU observation stopped unexpectedly", exception);
            SetConnectionState(
                LcuGatewayConnectionState.Searching,
                "LCU observation stopped unexpectedly; restart it to try again.");
        }
    }

    private async Task ObserveConnectedClientAsync(CancellationToken cancellationToken)
    {
        EnsureSubscriptions();
        SetConnectionState(LcuGatewayConnectionState.Connected, "Connected to the local League Client.");
        UpdateStatus(status => status with
        {
            TftEogStatsEndpointState = LcuTftEogStatsEndpointState.Unknown,
            TftEogStatsObservedAtUtc = null,
        });

        try
        {
            var data = await _lcuHttpClient
                .GetAsync<JsonElement>(GameflowPhasePath, cancellationToken)
                .ConfigureAwait(false);
            ObserveGameflowPhase(data, LcuObservationSource.Recovery);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            LogSafeDebug("Could not read the current LCU gameflow phase", exception);
        }

        RequestTftEogStatsRead(LcuObservationSource.Recovery);
    }

    private void EnsureSubscriptions()
    {
        lock (_sync)
        {
            if (_gameflowSubscription is not null && _tftEogSubscription is not null)
            {
                return;
            }
        }

        IDisposable? gameflowSubscription = null;
        IDisposable? tftEogSubscription = null;

        try
        {
            gameflowSubscription = _eventStream.Subscribe<JsonElement>(
                GameflowPhasePath,
                data => ObserveGameflowPhase(data, LcuObservationSource.Event),
                withSnapshot: false);
            tftEogSubscription = _eventStream.Subscribe<JsonElement>(
                TftEogStatsPath,
                _ => RequestTftEogStatsRead(LcuObservationSource.Event),
                withSnapshot: false);

            lock (_sync)
            {
                if (_gameflowSubscription is null && _tftEogSubscription is null)
                {
                    _gameflowSubscription = gameflowSubscription;
                    _tftEogSubscription = tftEogSubscription;
                    gameflowSubscription = null;
                    tftEogSubscription = null;
                }
            }
        }
        finally
        {
            gameflowSubscription?.Dispose();
            tftEogSubscription?.Dispose();
        }
    }

    private void ObserveGameflowPhase(JsonElement data, LcuObservationSource source)
    {
        var phase = ReadGameflowPhase(data);
        var observedAtUtc = DateTimeOffset.UtcNow;

        UpdateStatus(status => status with
        {
            GameflowPhase = phase,
            GameflowPhaseObservedAtUtc = observedAtUtc,
        });
        RaiseGameflowPhaseChanged(new LcuGameflowPhaseChanged(phase, observedAtUtc, source));

        if (IsTerminalGameflowPhase(phase))
        {
            RequestTftEogStatsRead(source);
        }
    }

    private void RequestTftEogStatsRead(LcuObservationSource source)
    {
        CancellationToken cancellationToken;

        lock (_sync)
        {
            if (_lifetimeCancellation is null || _lifetimeCancellation.IsCancellationRequested)
            {
                return;
            }

            cancellationToken = _lifetimeCancellation.Token;

            if (!_eogReadGate.Wait(0))
            {
                _eogRescanRequested = true;
                _eogRescanSource = source;
                return;
            }

            _eogReadTask = Task.Run(
                () => DrainTftEogStatsReadsAsync(source, cancellationToken),
                CancellationToken.None);
        }
    }

    private async Task DrainTftEogStatsReadsAsync(
        LcuObservationSource source,
        CancellationToken cancellationToken)
    {
        try
        {
            var nextSource = source;

            while (!cancellationToken.IsCancellationRequested)
            {
                await ReadTftEogStatsAsync(nextSource, cancellationToken).ConfigureAwait(false);

                lock (_sync)
                {
                    if (!_eogRescanRequested)
                    {
                        return;
                    }

                    nextSource = _eogRescanSource;
                    _eogRescanRequested = false;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        catch (Exception exception)
        {
            LogSafeDebug("Could not read TFT EOG stats", exception);
            UpdateTftEogEndpoint(LcuTftEogStatsEndpointState.Unavailable, null);
        }
        finally
        {
            _eogReadGate.Release();

            lock (_sync)
            {
                _eogReadTask = null;
            }
        }
    }

    private async Task ReadTftEogStatsAsync(LcuObservationSource source, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, TftEogStatsPath);
        using var response = await _lcuHttpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var endpointState = response.StatusCode == HttpStatusCode.NotFound
                ? LcuTftEogStatsEndpointState.Unsupported
                : LcuTftEogStatsEndpointState.Unavailable;
            UpdateTftEogEndpoint(endpointState, null);
            _logger.LogDebug(
                "The TFT EOG endpoint did not return success ({StatusCode}).",
                (int)response.StatusCode);
            return;
        }

        var payload = await ReadBoundedTftEogResponseAsync(response, cancellationToken)
            .ConfigureAwait(false);
        LcuTftEogStatsObserved observation;

        using (payload)
        {
            if (payload.IsOversized)
            {
                UpdateTftEogEndpoint(LcuTftEogStatsEndpointState.Oversized, null);
                _logger.LogWarning(
                    "The TFT EOG endpoint response exceeded the {MaximumPayloadBytes} byte observation limit.",
                    MaxEogPayloadBytes);
                return;
            }

            var inspection = InspectTftEogPayload(payload.WrittenMemory);
            switch (inspection.State)
            {
                case TftEogPayloadInspectionState.Invalid:
                    UpdateTftEogEndpoint(LcuTftEogStatsEndpointState.Unavailable, null);
                    _logger.LogDebug("The TFT EOG endpoint response was not a valid JSON object.");
                    return;
                case TftEogPayloadInspectionState.NoUsableGameId:
                    UpdateTftEogEndpoint(LcuTftEogStatsEndpointState.NoData, null);
                    return;
            }

            var observedAtUtc = DateTimeOffset.UtcNow;
            UpdateTftEogEndpoint(LcuTftEogStatsEndpointState.Available, observedAtUtc);
            RaiseTftEogStatsCaptured(new LcuTftEogStatsCaptured(
                payload.WrittenMemory,
                inspection.GameId!,
                observedAtUtc,
                source));
            observation = new LcuTftEogStatsObserved(observedAtUtc, source);
        }

        RaiseTftEogStatsObserved(observation);
    }

    private static async Task<PooledEogPayload> ReadBoundedTftEogResponseAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var contentLength = response.Content.Headers.ContentLength;
        if (contentLength is > MaxEogPayloadBytes)
        {
            return PooledEogPayload.Oversized;
        }

        await using var stream = await response.Content
            .ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        var payload = new PooledEogPayload();

        try
        {
            while (payload.Length < MaxEogPayloadBytes)
            {
                var bytesToRead = Math.Min(ReadBufferBytes, MaxEogPayloadBytes - payload.Length);
                var destination = payload.GetWritableMemory(bytesToRead);
                var bytesRead = await stream.ReadAsync(destination, cancellationToken).ConfigureAwait(false);

                if (bytesRead == 0)
                {
                    return payload;
                }

                payload.Advance(bytesRead);
            }

            var sentinel = new byte[1];
            if (await stream.ReadAsync(sentinel, cancellationToken).ConfigureAwait(false) != 0)
            {
                payload.Dispose();
                return PooledEogPayload.Oversized;
            }

            return payload;
        }
        catch
        {
            payload.Dispose();
            throw;
        }
    }

    private static TftEogPayloadInspection InspectTftEogPayload(ReadOnlyMemory<byte> utf8Json)
    {
        if (utf8Json.IsEmpty)
        {
            return new(TftEogPayloadInspectionState.Invalid, null);
        }

        try
        {
            using var document = JsonDocument.Parse(utf8Json);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object)
            {
                return new(TftEogPayloadInspectionState.NoUsableGameId, null);
            }

            return TryReadGameId(root, out var gameId)
                ? new(TftEogPayloadInspectionState.UsableGameId, gameId)
                : new(TftEogPayloadInspectionState.NoUsableGameId, null);
        }
        catch (JsonException)
        {
            return new(TftEogPayloadInspectionState.Invalid, null);
        }
    }

    private void UpdateTftEogEndpoint(
        LcuTftEogStatsEndpointState endpointState,
        DateTimeOffset? observedAtUtc)
    {
        UpdateStatus(status => status with
        {
            TftEogStatsEndpointState = endpointState,
            TftEogStatsObservedAtUtc = observedAtUtc,
        });
    }

    private void SetConnectionState(LcuGatewayConnectionState connectionState, string detail)
    {
        LcuGatewayStatus? statusChanged = null;

        lock (_sync)
        {
            if (_currentStatus.ConnectionState == connectionState && _currentStatus.Detail == detail)
            {
                return;
            }

            _currentStatus = _currentStatus with
            {
                ConnectionState = connectionState,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
                Detail = detail,
            };
            statusChanged = _currentStatus;
        }

        RaiseStatusChanged(statusChanged);
    }

    private void UpdateStatus(Func<LcuGatewayStatus, LcuGatewayStatus> update)
    {
        ArgumentNullException.ThrowIfNull(update);

        LcuGatewayStatus statusChanged;
        lock (_sync)
        {
            statusChanged = update(_currentStatus) with { UpdatedAtUtc = DateTimeOffset.UtcNow };
            _currentStatus = statusChanged;
        }

        RaiseStatusChanged(statusChanged);
    }

    private void RaiseStatusChanged(LcuGatewayStatus status)
    {
        var handlers = StatusChanged;
        if (handlers is null)
        {
            return;
        }

        foreach (Action<LcuGatewayStatus> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(status);
            }
            catch (Exception exception)
            {
                LogSafeDebug("An LCU status handler threw", exception);
            }
        }
    }

    private void RaiseGameflowPhaseChanged(LcuGameflowPhaseChanged observation)
    {
        var handlers = GameflowPhaseChanged;
        if (handlers is null)
        {
            return;
        }

        foreach (Action<LcuGameflowPhaseChanged> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(observation);
            }
            catch (Exception exception)
            {
                LogSafeDebug("An LCU gameflow handler threw", exception);
            }
        }
    }

    private void RaiseTftEogStatsObserved(LcuTftEogStatsObserved observation)
    {
        var handlers = TftEogStatsObserved;
        if (handlers is null)
        {
            return;
        }

        foreach (Action<LcuTftEogStatsObserved> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(observation);
            }
            catch (Exception exception)
            {
                LogSafeDebug("A TFT EOG observation handler threw", exception);
            }
        }
    }

    private void RaiseTftEogStatsCaptured(LcuTftEogStatsCaptured capture)
    {
        var handlers = TftEogStatsCaptured;
        if (handlers is null)
        {
            return;
        }

        foreach (Action<LcuTftEogStatsCaptured> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(capture);
            }
            catch (Exception exception)
            {
                LogSafeDebug("A TFT EOG capture handler threw", exception);
            }
        }
    }

    private void LogSafeDebug(string action, Exception exception)
    {
        _logger.LogDebug(
            "{Action} ({ExceptionType}).",
            action,
            exception.GetType().Name);
    }

    private static string? ReadGameflowPhase(JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var phase = data.GetString();
        return string.IsNullOrWhiteSpace(phase) || phase.Length > 64 ? null : phase;
    }

    private static bool IsTerminalGameflowPhase(string? phase) => phase is
        "WaitingForStats" or
        "PreEndOfGame" or
        "EndOfGame";

    private static bool TryReadGameId(JsonElement root, out string? gameId)
    {
        gameId = null;

        if (!root.TryGetProperty("gameId", out var gameIdElement))
        {
            return false;
        }

        var candidate = gameIdElement.ValueKind switch
        {
            JsonValueKind.String => !string.IsNullOrWhiteSpace(gameIdElement.GetString()),
            JsonValueKind.Number => true,
            _ => false,
        };

        if (!candidate)
        {
            return false;
        }

        gameId = gameIdElement.ValueKind == JsonValueKind.String
            ? gameIdElement.GetString()
            : gameIdElement.GetRawText();
        return true;
    }

    private static LcuGatewayStatus CreateStoppedStatus() => new(
        LcuGatewayConnectionState.Stopped,
        DateTimeOffset.UtcNow,
        null,
        null,
        LcuTftEogStatsEndpointState.Unknown,
        null,
        "LCU observation is stopped.");

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private enum TftEogPayloadInspectionState
    {
        Invalid,
        NoUsableGameId,
        UsableGameId,
        Oversized,
    }

    private readonly record struct TftEogPayloadInspection(
        TftEogPayloadInspectionState State,
        string? GameId);

    /// <summary>
    /// A pooled response buffer that clears participant data before returning it to the shared
    /// pool. The backing memory is borrowed by event handlers only while this instance is alive.
    /// </summary>
    private sealed class PooledEogPayload : IDisposable
    {
        private byte[]? _buffer;

        public PooledEogPayload()
        {
            _buffer = ArrayPool<byte>.Shared.Rent(ReadBufferBytes);
        }

        private PooledEogPayload(bool oversized)
        {
            IsOversized = oversized;
        }

        public static PooledEogPayload Oversized { get; } = new(oversized: true);

        public bool IsOversized { get; }

        public int Length { get; private set; }

        public ReadOnlyMemory<byte> WrittenMemory => _buffer is null
            ? ReadOnlyMemory<byte>.Empty
            : _buffer.AsMemory(0, Length);

        public Memory<byte> GetWritableMemory(int minimumLength)
        {
            ArgumentOutOfRangeException.ThrowIfNegativeOrZero(minimumLength);
            if (IsOversized || _buffer is null)
            {
                throw new InvalidOperationException("The EOG response buffer is not writable.");
            }

            var requiredLength = checked(Length + minimumLength);
            if (requiredLength > MaxEogPayloadBytes)
            {
                throw new InvalidOperationException("The EOG response exceeds its configured size limit.");
            }

            if (requiredLength > _buffer.Length)
            {
                var capacity = Math.Min(
                    MaxEogPayloadBytes,
                    Math.Max(requiredLength, checked(_buffer.Length * 2)));
                var replacement = ArrayPool<byte>.Shared.Rent(capacity);
                _buffer.AsSpan(0, Length).CopyTo(replacement);
                Array.Clear(_buffer, 0, Length);
                ArrayPool<byte>.Shared.Return(_buffer);
                _buffer = replacement;
            }

            return _buffer.AsMemory(Length, minimumLength);
        }

        public void Advance(int count)
        {
            ArgumentOutOfRangeException.ThrowIfNegative(count);
            if (_buffer is null || count > _buffer.Length - Length)
            {
                throw new ArgumentOutOfRangeException(nameof(count));
            }

            Length += count;
        }

        public void Dispose()
        {
            if (_buffer is null)
            {
                return;
            }

            Array.Clear(_buffer, 0, Length);
            ArrayPool<byte>.Shared.Return(_buffer);
            _buffer = null;
            Length = 0;
        }
    }
}
