using System;
using Microsoft.Extensions.DependencyInjection;
using players_lcu_client.Core.Lcu;

namespace players_lcu_client.Infrastructure.Lcu;

/// <summary>
/// Registers the read-only LCU gateway. The application composition root must register and
/// configure Thresh separately before resolving this service.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers a dormant singleton gateway; callers control its StartAsync/StopAsync lifetime.
    /// </summary>
    public static IServiceCollection AddReadOnlyTftLcuGateway(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton<ThreshLcuGateway>();
        services.AddSingleton<ILcuGateway>(serviceProvider =>
            serviceProvider.GetRequiredService<ThreshLcuGateway>());
        return services;
    }
}
