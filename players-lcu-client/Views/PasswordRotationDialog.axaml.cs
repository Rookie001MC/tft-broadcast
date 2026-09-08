using Avalonia.Controls;
using Avalonia.Interactivity;

namespace players_lcu_client.Views;

public partial class PasswordRotationDialog : Window
{
    public PasswordRotationDialog()
    {
        InitializeComponent();
    }

    private void Cancel_Click(object? sender, RoutedEventArgs eventArgs) => Close(false);

    private void Rotate_Click(object? sender, RoutedEventArgs eventArgs) => Close(true);
}
