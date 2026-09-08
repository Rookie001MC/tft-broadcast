# Simple Player Collector - TFT Broadcast

Requires Python 3.10+, standard library only. Reads real local LCU EOG only; never loads example or mock data.

## CMD modes

```cmd
python collector.py --mode capture
python collector.py --mode relay
python collector.py --mode capture --once
python collector.py --check-server
```

- `capture` (default): saves EOG locally without queueing/uploading.
- `relay`: saves EOG and uploads via Player Relay v1.
- `--once`: one iteration; exit 0 means capture succeeded, not necessarily upload. Check deliveryState separately.
- `--check-server`: authenticated handshake only, no upload; exit 0 means compatible relay connected.
- `--capture-only`: legacy alias for capture mode.

START_CAPTURE.bat uses capture; START_COLLECTOR.bat uses relay. CHECK_EOG.bat checks real EOG once; CHECK_SERVER.bat checks the relay. Stop with Ctrl+C before switching modes. Run only one collector per folder.

## Configuration

Copy config.example.json to config.json if missing. Set server_url to the actual broadcast origin shown in admin, for example http://192.168.1.10:5173 (no API path). Set relay_password to the existing shared Player Relay password, NOT EOG_INGEST_TOKEN or the old collector token. This tool does not bootstrap or rotate passwords. Leave lockfile empty for discovery or specify the League Client lockfile. poll_seconds is at least 2 seconds.

Run CHECK_SERVER.bat, then START_COLLECTOR.bat. Keep League Client and the end-of-game screen open. LCU may hold an older match; check gameId.

## Delivery and operator status

Uploads use /api/player-relay/v1/captures with Bearer auth, Idempotency-Key, a v1 envelope and SHA-256 of unchanged raw EOG JSON. LCU credentials are never sent. SERVER ACKNOWLEDGED requires a matching capture ID, stored/duplicate receipt and valid receivedAt timestamp.

relay-pending/ persists envelopes before upload; retries retain the same Capture ID and contents across restarts. Changing server_url does not reroute old queued captures. Failed uploads remain queued and retry; inspect HTTP errors, correct config and restart. Legacy pending/ and sent.json are preserved and not automatically uploaded using the new protocol.

status.json separates captureState from deliveryState. Web /admin/post-game displays received captures, player/client identities and server receipt time. A receipt does not automatically import preview or publish to OBS. Local queue/errors are not sent as telemetry to web admin.

Copy only source, launchers and config to another player PC. Do not copy installation.json, relay-pending/, relay-sent.json, status.json or EOG data: each PC creates its own installation identity. Credentials and runtime data are gitignored.
