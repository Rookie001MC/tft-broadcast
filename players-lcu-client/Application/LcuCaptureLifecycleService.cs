using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Lcu;

namespace players_lcu_client.Application;

/// <summary>
/// Starts LCU observation with the desktop app and immediately commits any borrowed EOG payload
/// to the local spool before Thresh clears its buffer.
/// </summary>
public sealed class LcuCaptureLifecycleService : IApplicationLifecycleService
{
    private readonly ILcuGateway _lcuGateway;
    private readonly ITftEogCaptureStore _captureStore;
    private readonly ILogger<LcuCaptureLifecycleService> _logger;
    private bool _isSubscribed;

    public LcuCaptureLifecycleService(
        ILcuGateway lcuGateway,
        ITftEogCaptureStore captureStore,
        ILogger<LcuCaptureLifecycleService> logger)
    {
        _lcuGateway = lcuGateway;
        _captureStore = captureStore;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _captureStore.Initialize();
        _lcuGateway.TftEogStatsCaptured += PersistCapturedResult;
        _isSubscribed = true;

        try
        {
            await _lcuGateway.StartAsync(cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            _lcuGateway.TftEogStatsCaptured -= PersistCapturedResult;
            _isSubscribed = false;
            throw;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_isSubscribed)
        {
            _lcuGateway.TftEogStatsCaptured -= PersistCapturedResult;
            _isSubscribed = false;
        }

        await _lcuGateway.StopAsync(cancellationToken).ConfigureAwait(false);
    }

    private void PersistCapturedResult(LcuTftEogStatsCaptured capture)
    {
        var result = _captureStore.Persist(capture);

        if (result.IsStored)
        {
            _logger.LogInformation("TFT EOG result saved to the local spool.");
            return;
        }

        if (!result.IsDuplicate)
        {
            _logger.LogWarning("TFT EOG result could not be saved locally: {Detail}", result.Detail);
        }
    }
}
