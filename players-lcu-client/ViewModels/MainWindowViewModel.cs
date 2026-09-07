using System;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Lcu;

namespace players_lcu_client.ViewModels;

public sealed partial class MainWindowViewModel : ViewModelBase, IDisposable
{
    private readonly ILcuGateway _lcuGateway;
    private readonly ITftEogCaptureStore _captureStore;

    [ObservableProperty]
    private string _leagueStatus = "League: starting…";

    [ObservableProperty]
    private string _captureStatus = "Local capture: starting…";

    public MainWindowViewModel(
        ILcuGateway lcuGateway,
        ITftEogCaptureStore captureStore,
        ILogger<MainWindowViewModel> logger)
    {
        _lcuGateway = lcuGateway;
        _captureStore = captureStore;
        _lcuGateway.StatusChanged += OnLcuStatusChanged;
        _captureStore.StatusChanged += OnCaptureSpoolStatusChanged;
        SetLeagueStatus(_lcuGateway.CurrentStatus);
        SetCaptureStatus(_captureStore.CurrentStatus);
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
}
