using System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using players_lcu_client.Application;
using players_lcu_client.Core.Capture;
using players_lcu_client.Infrastructure.Lcu;
using players_lcu_client.Infrastructure.Logging;
using players_lcu_client.Infrastructure.Storage;
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
        services.AddSingleton<ITftEogCaptureStore, FileTftEogCaptureStore>();
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
