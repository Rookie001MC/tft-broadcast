using System.Threading;
using System.Threading.Tasks;

namespace players_lcu_client.Application;

/// <summary>
/// Defines an application-owned background component with an explicit lifetime.
/// </summary>
/// <remarks>
/// Implementations must return promptly from <see cref="StartAsync"/> and perform
/// ongoing work without blocking the Avalonia UI thread. The desktop host starts
/// services in registration order and stops them in reverse order.
/// </remarks>
public interface IApplicationLifecycleService
{
    Task StartAsync(CancellationToken cancellationToken);

    Task StopAsync(CancellationToken cancellationToken);
}
