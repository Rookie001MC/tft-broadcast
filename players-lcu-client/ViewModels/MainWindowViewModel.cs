using System;
using Avalonia.Threading;
using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Configuration;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Core.Lcu;
using players_lcu_client.Core.Security;
using players_lcu_client.Infrastructure.Configuration;
using players_lcu_client.Infrastructure.Transport;

namespace players_lcu_client.ViewModels;

public sealed partial class MainWindowViewModel : ViewModelBase, IDisposable
{
    private readonly ILcuGateway _lcuGateway;
    private readonly ITftEogCaptureStore _captureStore;
    private readonly IRelayDestinationSettingsStore _settingsStore;
    private readonly IDeviceTokenStore _tokenStore;
    private readonly IDeliveryQueueStore _queue;
    private readonly IRelayReceiverClient _relayReceiver;
    public ObservableCollection<RelayDebugRow> DebugRows { get; } = [];

    [ObservableProperty]
    private string _leagueStatus = "League: starting…";

    [ObservableProperty]
    private string _captureStatus = "Local capture: starting…";

    [ObservableProperty] private string _scheme = "http";
    [ObservableProperty] private string _host = "127.0.0.1";
    [ObservableProperty] private string _port = "5173";
    [ObservableProperty] private string _relayPassword = string.Empty;
    [ObservableProperty] private bool _isRelayPasswordVisible;
    [ObservableProperty] private string _settingsStatus = "Configure the relay server and shared relay password.";
    [ObservableProperty] private string _connectionStatus = "Not tested";
    [ObservableProperty] private string _connectionBadgeColor = "#64748B";
    [ObservableProperty] private string _alertMessage = "Configure the relay, then test its connection before the match begins.";
    [ObservableProperty] private string _alertBackground = "#334155";
    [ObservableProperty] private string _debugStatus = "Refresh to inspect the local capture queue.";

    public char RelayPasswordMaskCharacter => IsRelayPasswordVisible ? '\0' : '●';

    public event Func<Task<bool>>? PasswordRotationConfirmationRequested;

    public MainWindowViewModel(
        ILcuGateway lcuGateway,
        ITftEogCaptureStore captureStore,
        IRelayDestinationSettingsStore settingsStore,
        IDeviceTokenStore tokenStore,
        IDeliveryQueueStore queue,
        IRelayReceiverClient relayReceiver,
        ILogger<MainWindowViewModel> logger)
    {
        _lcuGateway = lcuGateway;
        _captureStore = captureStore;
        _settingsStore = settingsStore;
        _tokenStore = tokenStore;
        _queue = queue;
        _relayReceiver = relayReceiver;
        _lcuGateway.StatusChanged += OnLcuStatusChanged;
        _captureStore.StatusChanged += OnCaptureSpoolStatusChanged;
        SetLeagueStatus(_lcuGateway.CurrentStatus);
        SetCaptureStatus(_captureStore.CurrentStatus);
        LoadSettings();
        _ = RefreshDebugAsync();
        logger.LogInformation("Desktop status view model initialized.");
    }

    public void Dispose()
    {
        _lcuGateway.StatusChanged -= OnLcuStatusChanged;
        _captureStore.StatusChanged -= OnCaptureSpoolStatusChanged;
    }

    private void OnLcuStatusChanged(LcuGatewayStatus status) =>
        Dispatcher.UIThread.Post(() => SetLeagueStatus(status));

    private void OnCaptureSpoolStatusChanged(CaptureSpoolStatus status) =>
        Dispatcher.UIThread.Post(() => SetCaptureStatus(status));

    private void SetLeagueStatus(LcuGatewayStatus status)
    {
        LeagueStatus = $"League: {status.Detail}";
    }

    private void SetCaptureStatus(CaptureSpoolStatus status)
    {
        var lastCapture = status.LastCapturedAtUtc is { } capturedAtUtc
            ? $" Last saved {capturedAtUtc.ToLocalTime():t}."
            : string.Empty;
        CaptureStatus = $"Local capture: {status.Detail}{lastCapture}";
    }

    partial void OnIsRelayPasswordVisibleChanged(bool value) => OnPropertyChanged(nameof(RelayPasswordMaskCharacter));

    [RelayCommand]
    private async Task SaveSettingsAsync()
    {
        if (!RelayDestination.TryCreate(Scheme, Host, Port, out var destination, out _ ) || destination is null)
        {
            SettingsStatus = "Enter a valid HTTP/HTTPS host and port (1–65535).";
            return;
        }

        if (!string.IsNullOrEmpty(RelayPassword))
        {
            if (!DeviceToken.TryCreate(RelayPassword, out var password, out _) || password is null)
            {
                SettingsStatus = "Enter a valid relay password.";
                return;
            }

            var storedPassword = _tokenStore.Load();
            if (!storedPassword.HasToken)
            {
                if (storedPassword.Status != DeviceTokenLoadStatus.NotFound)
                {
                    SettingsStatus = storedPassword.Detail ?? "Protected relay-password storage is unavailable.";
                    return;
                }
                var bootstrap = await _relayReceiver.BootstrapPasswordAsync(destination, password, default);
                if (bootstrap.Outcome == RelayPasswordBootstrapOutcome.AlreadyInitialized)
                {
                    var probe = await _relayReceiver.TestConnectionAsync(destination, password, default);
                    if (!probe.IsConnected)
                    {
                        SettingsStatus = "This relay already has a different password.";
                        return;
                    }
                }
                else if (bootstrap.Outcome != RelayPasswordBootstrapOutcome.Initialized)
                {
                    SettingsStatus = bootstrap.Detail;
                    return;
                }
            }
            else
            {
                var probe = await _relayReceiver.TestConnectionAsync(destination, password, default);
                if (!probe.IsConnected)
                {
                    SettingsStatus = probe.Detail;
                    return;
                }
            }

            if (!_tokenStore.Save(password).IsSuccess)
            {
                SettingsStatus = "The relay password could not be saved securely.";
                return;
            }
            RelayPassword = string.Empty;
            IsRelayPasswordVisible = false;
        }
        else if (!_tokenStore.Load().HasToken)
        {
            SettingsStatus = "Enter or generate a relay password before saving settings.";
            return;
        }

        if (!_settingsStore.Save(new RelayDestinationSettings(destination)).IsSuccess)
        {
            SettingsStatus = "The relay destination could not be saved.";
            return;
        }
        SettingsStatus = "Relay settings saved. Pending captures will retry automatically.";
    }

    [RelayCommand]
    private async Task GenerateRelayPasswordAsync()
    {
        var storedPassword = _tokenStore.Load();
        if (!storedPassword.HasToken || storedPassword.Token is null)
        {
            RelayPassword = GeneratePassword();
            IsRelayPasswordVisible = true;
            SettingsStatus = "New relay password generated. Save it to initialize the relay.";
            return;
        }

        if (!RelayDestination.TryCreate(Scheme, Host, Port, out var destination, out _) || destination is null)
        {
            SetConnectionState(false, "Configuration needed", "Enter a valid relay server before rotating its password.");
            return;
        }
        if (!await ConfirmPasswordRotationAsync()) return;

        var generatedPassword = GeneratePassword();
        if (!DeviceToken.TryCreate(generatedPassword, out var nextPassword, out _) || nextPassword is null)
        {
            SetConnectionState(false, "Password error", "A relay password could not be generated.");
            return;
        }

        var rotation = await _relayReceiver.RotatePasswordAsync(destination, storedPassword.Token, nextPassword, default);
        if (rotation.Outcome != RelayPasswordRotationOutcome.Rotated)
        {
            SetConnectionState(false, "Password unchanged", rotation.Detail);
            return;
        }
        if (!_tokenStore.Save(nextPassword).IsSuccess)
        {
            SetConnectionState(false, "Password rotated", "Relay password changed, but this PC could not store it securely. Copy the displayed password now.");
            RelayPassword = generatedPassword;
            IsRelayPasswordVisible = true;
            return;
        }

        RelayPassword = generatedPassword;
        IsRelayPasswordVisible = true;
        SetConnectionState(true, "Password rotated", "Relay password changed. Update every other Player LCU client before the next capture.");
    }

    [RelayCommand]
    private void ToggleRelayPasswordVisibility()
    {
        if (!string.IsNullOrEmpty(RelayPassword)) IsRelayPasswordVisible = !IsRelayPasswordVisible;
    }

    [RelayCommand]
    private async Task TestConnectionAsync()
    {
        if (!RelayDestination.TryCreate(Scheme, Host, Port, out var destination, out _) || destination is null)
        {
            SetConnectionState(false, "Configuration needed", "Enter a valid HTTP/HTTPS host and port before testing.");
            return;
        }

        DeviceToken? deviceToken;
        if (!string.IsNullOrEmpty(RelayPassword))
        {
            if (!DeviceToken.TryCreate(RelayPassword, out deviceToken, out _) || deviceToken is null)
            {
                SetConnectionState(false, "Password needed", "Enter a valid relay password before testing.");
                return;
            }
        }
        else
        {
            var loadedToken = _tokenStore.Load();
            if (!loadedToken.HasToken || loadedToken.Token is null)
            {
                SetConnectionState(false, "Password needed", loadedToken.Detail ?? "Save a relay password before testing the relay.");
                return;
            }
            deviceToken = loadedToken.Token;
        }

        ConnectionStatus = "Testing…";
        ConnectionBadgeColor = "#D97706";
        AlertMessage = $"Testing {destination.BaseUri}…";
        AlertBackground = "#92400E";
        var result = await _relayReceiver.TestConnectionAsync(destination, deviceToken, default);
        SetConnectionState(result.IsConnected, result.IsConnected ? "Connected" : "Connection failed", result.Detail);
    }

    private void LoadSettings()
    {
        var settings = _settingsStore.Load().Settings?.Destination;
        if (settings is null) return;
        Scheme = settings.Scheme == RelayDestinationScheme.Https ? "https" : "http";
        Host = settings.Host.Value;
        Port = settings.Port.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (_tokenStore.Load().HasToken) SettingsStatus = "Relay destination and protected relay password are configured.";
    }

    [RelayCommand]
    private async Task RefreshDebugAsync()
    {
        try
        {
            var items = await _queue.ReadRecentAsync(25);
            DebugRows.Clear();
            foreach (var item in items)
                DebugRows.Add(new RelayDebugRow(item.Envelope.GameId, item.Envelope.CaptureId.ToString("D"), item.State.ToString(), item.AttemptCount.ToString(), item.Envelope.PayloadJson));
            DebugStatus = items.Count == 0 ? "No captures have been queued yet." : $"Showing {items.Count} most recent capture(s).";
        }
        catch
        {
            DebugStatus = "The local debug queue could not be read.";
        }
    }

    private void SetConnectionState(bool connected, string status, string message)
    {
        ConnectionStatus = status;
        ConnectionBadgeColor = connected ? "#16A34A" : "#DC2626";
        AlertMessage = message;
        AlertBackground = connected ? "#166534" : "#991B1B";
    }

    private static string GeneratePassword()
    {
        var bytes = RandomNumberGenerator.GetBytes(24);
        try
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    private async Task<bool> ConfirmPasswordRotationAsync()
    {
        var confirmation = PasswordRotationConfirmationRequested;
        if (confirmation is null) return false;
        foreach (var callback in confirmation.GetInvocationList())
        {
            if (!await ((Func<Task<bool>>)callback)()) return false;
        }
        return true;
    }
}

public sealed record RelayDebugRow(string GameId, string CaptureId, string State, string Attempts, string PayloadJson);
