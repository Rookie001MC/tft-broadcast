# TFT Player LCU Client

Small Windows desktop client that observes the local League Client during a TFT game. It only talks to the League Client on the player PC; the receiver/upload workflow is configured separately as that work lands.

For the immediate rehearsal, a detected TFT EOG response is copied atomically to `%LOCALAPPDATA%\TftPlayerRelay\captures\<capture-id>\`. Each directory contains the original `payload.json` and a `capture.json` manifest with its SHA-256. These local captures are intentionally retained and deduplicated by game ID plus payload hash; they are not yet uploaded. This is a crash-safe emergency spool, not the planned SQLite delivery queue.

## Fast Windows rehearsal

1. Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) on the PC used to publish. The published client itself is self-contained and does not need a .NET runtime.
2. From PowerShell, at the repository root, publish a fresh build:

   ```powershell
   .\players-lcu-client\scripts\publish.ps1
   ```

   The script writes only to `players-lcu-client\artifacts\publish\win-x64`. It refuses to overwrite a non-empty prior build; review or remove that exact directory before creating another rehearsal build.
3. Copy the resulting `players-lcu-client\artifacts\publish\win-x64` folder to the tournament PC, if it is a different machine.
4. Start the League Client, sign in, then run `players-lcu-client.exe`. No administrator privileges, LCU password, or certificate files are required.
5. Keep the client open through the TFT game and its end-of-game screen. Its League status should move from searching to connected once the local League Client is available. After game completion, confirm the local-capture status says the result was saved. If needed, verify a new directory exists under `%LOCALAPPDATA%\TftPlayerRelay\captures`.

Close the client normally after the rehearsal. It is read-only with respect to the League Client and does not alter game files or client settings.

## Delivery status

The main window automatically reads delivery metadata every two seconds and shows the latest 25 captures, newest first. Each row includes game/capture ID, attempt count, delivery state, receiver acknowledgment time, and any safe error code or scheduled retry time. Raw game JSON remains in the separate manual debug view.

- **Queued / Sending / Retry scheduled**: delivery is not yet confirmed. Keep the app open; scheduled retries run automatically.
- **Received by server**: a matching stored or duplicate receipt has been saved locally. This does not publish a graphic to OBS.
- **Blocked / Rejected**: follow the row's guidance and contact the broadcast operator. These captures are retained but do not automatically retry after editing settings.
- **Storage unavailable**: status cannot be confirmed; the UI clears stale rows and retries its metadata read.

The connection-test badge describes the last manual connection test, independently of capture delivery. The summary counts cover only the displayed latest 25 captures.

## Local development

On a development PC with the .NET 10 SDK:

```powershell
dotnet run --project .\players-lcu-client\players-lcu-client.csproj
```

The client discovers the locally running League Client. If it remains in a searching state, verify that League is running and that this client is running on the same PC and Windows user session.
