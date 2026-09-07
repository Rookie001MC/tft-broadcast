using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace players_lcu_client.Application;

/// <summary>
/// Owns the application service provider and the lifetimes of background services.
/// </summary>
public sealed class DesktopApplicationHost : IAsyncDisposable
{
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(5);

    private readonly ServiceProvider _serviceProvider;
    private readonly IReadOnlyList<IApplicationLifecycleService> _lifecycleServices;
    private readonly List<IApplicationLifecycleService> _startedServices = [];
    private readonly ILogger<DesktopApplicationHost> _logger;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private bool _isDisposed;
    private bool _isStarted;

    public DesktopApplicationHost(ServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider ?? throw new ArgumentNullException(nameof(serviceProvider));
        _lifecycleServices = _serviceProvider.GetServices<IApplicationLifecycleService>().ToArray();
        _logger = _serviceProvider.GetRequiredService<ILogger<DesktopApplicationHost>>();
    }

    public IServiceProvider Services => _serviceProvider;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            if (_isStarted)
            {
                return;
            }

            foreach (var service in _lifecycleServices)
            {
                await service.StartAsync(cancellationToken).ConfigureAwait(false);
                _startedServices.Add(service);
            }

            _isStarted = true;
            _logger.LogInformation("Desktop application host started with {ServiceCount} lifecycle services.", _startedServices.Count);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Desktop application host failed to start.");
            await StopStartedServicesAsync(CancellationToken.None).ConfigureAwait(false);
            throw;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            if (!_isStarted && _startedServices.Count == 0)
            {
                return;
            }

            await StopStartedServicesAsync(cancellationToken).ConfigureAwait(false);
            _isStarted = false;
            _logger.LogInformation("Desktop application host stopped.");
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_isDisposed)
        {
            return;
        }

        _isDisposed = true;

        using var timeout = new CancellationTokenSource(ShutdownTimeout);
        try
        {
            await StopAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            _logger.LogWarning("Timed out while stopping desktop application services.");
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Desktop application services did not stop cleanly.");
        }
        finally
        {
            await _serviceProvider.DisposeAsync().ConfigureAwait(false);
            _lifecycleGate.Dispose();
        }
    }

    private async Task StopStartedServicesAsync(CancellationToken cancellationToken)
    {
        Exception? stopFailure = null;

        for (var index = _startedServices.Count - 1; index >= 0; index--)
        {
            try
            {
                await _startedServices[index].StopAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                stopFailure ??= exception;
                _logger.LogError(exception, "Application lifecycle service {ServiceType} did not stop cleanly.", _startedServices[index].GetType().FullName);
            }
        }

        _startedServices.Clear();

        if (stopFailure is not null)
        {
            throw new InvalidOperationException("One or more application lifecycle services did not stop cleanly.", stopFailure);
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);
    }
}
