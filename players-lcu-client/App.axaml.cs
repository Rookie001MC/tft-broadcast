using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Data.Core;
using Avalonia.Data.Core.Plugins;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.DependencyInjection;
using players_lcu_client.Application;
using players_lcu_client.Composition;
using players_lcu_client.Views;

namespace players_lcu_client;

public partial class App : Avalonia.Application
{
    private DesktopApplicationHost? _applicationHost;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            // Avoid duplicate validations from both Avalonia and the CommunityToolkit. 
            // More info: https://docs.avaloniaui.net/docs/guides/development-guides/data-validation#manage-validationplugins
            DisableAvaloniaDataAnnotationValidation();
            _applicationHost = new ServiceCollection()
                .AddPlayerLcuClient()
                .BuildDesktopApplicationHost();

            desktop.MainWindow = _applicationHost.Services.GetRequiredService<MainWindow>();
            desktop.Exit += OnDesktopExit;
            _ = StartApplicationHostAsync(_applicationHost);
        }

        base.OnFrameworkInitializationCompleted();
    }

    private static async Task StartApplicationHostAsync(DesktopApplicationHost applicationHost)
    {
        try
        {
            await applicationHost.StartAsync();
        }
        catch
        {
            // The host logs startup failures. The placeholder UI remains available
            // so a later collector can surface an actionable status to the user.
        }
    }

    private void OnDesktopExit(object? sender, ControlledApplicationLifetimeExitEventArgs eventArgs)
    {
        if (_applicationHost is null)
        {
            return;
        }

        _applicationHost.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _applicationHost = null;
    }

    private void DisableAvaloniaDataAnnotationValidation()
    {
        // Get an array of plugins to remove
        var dataValidationPluginsToRemove =
            BindingPlugins.DataValidators.OfType<DataAnnotationsValidationPlugin>().ToArray();

        // remove each entry found
        foreach (var plugin in dataValidationPluginsToRemove)
        {
            BindingPlugins.DataValidators.Remove(plugin);
        }
    }
}
