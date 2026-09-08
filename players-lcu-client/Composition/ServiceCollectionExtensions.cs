using System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using players_lcu_client.Application;
using players_lcu_client.Core.Capture;
using players_lcu_client.Core.Delivery;
using players_lcu_client.Core.Security;
using players_lcu_client.Infrastructure.Configuration;
using players_lcu_client.Infrastructure.Lcu;
using players_lcu_client.Infrastructure.Logging;
using players_lcu_client.Infrastructure.Security;
using players_lcu_client.Infrastructure.Storage;
using players_lcu_client.Infrastructure.Transport;
using players_lcu_client.ViewModels;
using players_lcu_client.Views;
using Thresh.Extensions;

namespace players_lcu_client.Composition;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers the desktop composition root. LCU behavior remains behind
    /// application services so the UI does not depend on a transport implementation.
    /// </summary>
    public static IServiceCollection AddPlayerLcuClient(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services
            .AddLogging(logging =>
            {
                logging.ClearProviders();
                logging.AddProvider(new TraceLoggerProvider());
                logging.SetMinimumLevel(LogLevel.Information);
            })
            .AddThresh(options =>
            {
                options.AcceptSelfSignedCertificates = true;
                options.WsAcceptSelfSignedCertificates = true;
        });

        services.AddReadOnlyTftLcuGateway();
        services.AddSingleton<IDeliveryQueueStore, SqliteDeliveryQueueStore>();
        services.AddSingleton<IInstallationIdentityStore, FileInstallationIdentityStore>();
        services.AddSingleton<IRelayDestinationSettingsStore, FileRelayDestinationSettingsStore>();
#pragma warning disable CA1416 // The store returns an explicit availability result outside Windows.
        services.AddSingleton<IDeviceTokenStore, WindowsDpapiDeviceTokenStore>();
#pragma warning restore CA1416
        services.AddSingleton<IRelayReceiverClient, RelayReceiverHttpClient>();
        services.AddSingleton<ITftEogCaptureStore, SqliteTftEogCaptureStore>();
        services.AddSingleton<IApplicationLifecycleService, RelayDeliveryService>();
        services.AddSingleton<IApplicationLifecycleService, LcuCaptureLifecycleService>();
        services.AddSingleton<MainWindowViewModel>();
        services.AddSingleton<MainWindow>();

        return services;
    }

    public static DesktopApplicationHost BuildDesktopApplicationHost(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        return new DesktopApplicationHost(services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateScopes = true,
            ValidateOnBuild = true,
        }));
    }
}
