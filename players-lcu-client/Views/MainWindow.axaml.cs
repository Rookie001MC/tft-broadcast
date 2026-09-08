using Avalonia.Controls;
using System.Threading.Tasks;
using players_lcu_client.ViewModels;

namespace players_lcu_client.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    public MainWindow(MainWindowViewModel viewModel)
        : this()
    {
        DataContext = viewModel;
        viewModel.PasswordRotationConfirmationRequested += ConfirmPasswordRotationAsync;
    }

    private async Task<bool> ConfirmPasswordRotationAsync()
    {
        var dialog = new PasswordRotationDialog();
        return await dialog.ShowDialog<bool>(this);
    }
}
