using System;
using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace players_lcu_client.Infrastructure.Logging;

/// <summary>
/// Sends structured application logs to the debugger trace stream without creating
/// console windows for the Windows desktop executable.
/// </summary>
internal sealed class TraceLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new TraceLogger(categoryName);

    public void Dispose()
    {
    }

    private sealed class TraceLogger(string categoryName) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            var message = formatter(state, exception);
            Trace.WriteLine($"{DateTimeOffset.UtcNow:O} [{logLevel}] {categoryName}: {message}");

            if (exception is not null)
            {
                Trace.WriteLine(exception.ToString());
            }
        }
    }
}
