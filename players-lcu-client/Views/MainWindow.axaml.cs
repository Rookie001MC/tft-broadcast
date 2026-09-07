using Avalonia.Controls;
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
    }
}
