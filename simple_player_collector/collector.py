"""Standalone stdlib-only TFT EOG collector. Never forwards LCU credentials."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import ssl
import subprocess
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def write_atomic(path, body):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(body)
    temporary.replace(path)


def find_lockfile(config):
    if config.get('lockfile'):
        return Path(config['lockfile'])
    result = subprocess.run(
        ['powershell', '-NoProfile', '-Command',
         '(Get-Process LeagueClient -ErrorAction SilentlyContinue).Path'],
        capture_output=True, text=True, timeout=8)
    for line in result.stdout.splitlines():
        candidate = Path(line.strip()).parent / 'lockfile'
        if candidate.is_file():
            return candidate
    for drive in ('C', 'D', 'E'):
        candidate = Path(f'{drive}:/Riot Games/League of Legends/lockfile')
        if candidate.is_file():
            return candidate
    raise FileNotFoundError('League Client lockfile not found')


def read_eog(lockfile):
    _, _, port, password, protocol = lockfile.read_text().strip().split(':')
    if protocol != 'https' or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ValueError('Invalid lockfile')
    auth = base64.b64encode(f'riot:{password}'.encode()).decode()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
    request = urllib.request.Request(
        f'https://127.0.0.1:{port}/lol-end-of-game/v1/tft-eog-stats',
        headers={'Authorization': 'Basic ' + auth})
    with opener.open(request, timeout=5) as response:
        body = response.read()
    data = json.loads(body)
    if not isinstance(data, dict) or not data.get('gameId') or not data.get('players'):
        return None
    game_id = data['gameId']
    if isinstance(game_id, bool) or not str(game_id).isdecimal() or not isinstance(data['players'], list):
        raise ValueError('Invalid EOG structure')
    return str(game_id), len(data['players']), body


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def server_url(config):
    url = config.get('server_url', '').rstrip('/')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise ValueError('Set server_url to the broadcast origin, e.g. http://192.168.1.10:5173')
    return url


def relay_request(config, endpoint, envelope=None):
    password = config.get('relay_password', '')
    if not isinstance(password, str) or not password.strip():
        raise ValueError('Set relay_password to the shared Player Relay password, not EOG_INGEST_TOKEN')
    headers = {'Authorization': 'Bearer ' + password}
    body = None
    if envelope is not None:
        body = json.dumps(envelope, ensure_ascii=False).encode('utf-8')
        headers.update({'Content-Type': 'application/json', 'Idempotency-Key': envelope['captureId']})
    request = urllib.request.Request(server_url(config) + endpoint, data=body, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=8) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise ValueError('Invalid relay response')
    return result


def queue_capture(config, pending, game_id, body):
    if len(body) > 4 * 1024 * 1024:
        raise ValueError('EOG exceeds the relay 4 MB limit')
    payload = body.decode('utf-8')
    data = json.loads(payload)
    identity_path = ROOT / 'installation.json'
    if identity_path.exists():
        identity = json.loads(identity_path.read_text())
    else:
        identity = {'id': str(uuid.uuid4()), 'sequence': 0}
    digest = hashlib.sha256(body).hexdigest()
    capture_id = str(uuid.uuid5(uuid.UUID(identity['id']), game_id + ':' + digest))
    destination = server_url(config)
    filename = pending / f'{capture_id}.json'
    if filename.exists():
        return
    identity['sequence'] += 1
    write_atomic(identity_path, json.dumps(identity).encode())
    local = data.get('localPlayer') or {}
    def optional(key, limit):
        value = local.get(key)
        return value if isinstance(value, str) and 0 < len(value) <= limit else None
    envelope = {
        'protocolVersion': 1, 'captureId': capture_id, 'installationId': identity['id'],
        'sequence': str(identity['sequence']),
        'capturedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'appVersion': 'simple-player-collector/1.0', 'observationKind': 'recovery',
        'sourcePlatform': None, 'gameId': game_id,
        'localPlayer': {'puuid': optional('puuid', 256), 'gameName': optional('riotIdGameName', 100), 'tagLine': optional('riotIdTagLine', 100)},
        'context': None, 'payloadSha256': digest, 'payloadJson': payload
    }
    write_atomic(filename, json.dumps({'serverUrl': destination, 'capture': envelope}, ensure_ascii=False).encode('utf-8'))


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Check real LCU once, then exit')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--mode', choices=('capture', 'relay'), default='capture', help='capture: save locally (default); relay: save and upload to Player Relay v1')
    mode.add_argument('--capture-only', action='store_true', help='Alias for --mode capture')
    parser.add_argument('--check-server', action='store_true', help='Check real relay authentication without uploading')
    args = parser.parse_args()
    args.capture_only = args.capture_only or args.mode == 'capture'
    config = json.loads((ROOT / 'config.json').read_text(encoding='utf-8-sig'))
    if args.check_server:
        try:
            result = relay_request(config, '/api/player-relay/v1/handshake')
            if result.get('protocolVersion') != 1:
                raise ValueError('Unsupported relay protocol')
            print('RELAY CONNECTED: protocol v1. No capture uploaded.', flush=True)
            return 0
        except urllib.error.HTTPError as error:
            print(f'RELAY NOT CONNECTED: HTTP {error.code}. Check relay password, URL and server.', flush=True)
        except ValueError as error:
            print(f'RELAY NOT CONNECTED: {error}', flush=True)
        except Exception as error:
            print(f'RELAY NOT CONNECTED: {type(error).__name__}. Check server and LAN.', flush=True)
        return 1
    folder, pending = ROOT / 'eog', ROOT / 'relay-pending'
    folder.mkdir(exist_ok=True)
    if not args.capture_only:
        pending.mkdir(exist_ok=True)
    sent_path = ROOT / 'relay-sent.json'
    sent = json.loads(sent_path.read_text()) if sent_path.exists() else {}
    print('TFT EOG collector - REAL LCU ONLY. Keep the post-match screen open. Ctrl+C to stop.', flush=True)
    print('MODE: ' + ('capture (local only)' if args.capture_only else 'relay (local + server upload)'), flush=True)
    print('A captured result may be an older match still held by LCU. Check its game ID.', flush=True)
    while True:
        status = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'captureState': 'waiting',
                  'message': '', 'deliveryState': 'disabled' if args.capture_only else 'idle'}
        exit_code = 2
        try:
            capture = read_eog(find_lockfile(config))
            if capture is None:
                status['message'] = 'LCU connected, but no TFT EOG data yet. Keep the end-of-game screen open.'
            else:
                game_id, player_count, body = capture
                digest = hashlib.sha256(body).hexdigest()
                output = folder / f'{game_id}.json'
                if not output.exists() or output.read_bytes() != body:
                    write_atomic(output, body)
                status.update(captureState='captured', gameId=game_id, playerCount=player_count,
                              outputFile=str(output), sha256=digest,
                              message=f'EOG CAPTURED: game {game_id}, {player_count} players. Saved: {output}')
                exit_code = 0
                if not args.capture_only and sent.get(game_id) != digest:
                    queue_capture(config, pending, game_id, body)
                elif not args.capture_only:
                    status['deliveryState'] = 'already_sent'
        except FileNotFoundError:
            status['message'] = 'NO CAPTURE: League Client lockfile not found. Open League Client or set lockfile in config.json.'
        except urllib.error.HTTPError as error:
            status['captureState'] = 'waiting' if error.code == 404 else 'error'
            status['message'] = (f'NO CAPTURE: LCU HTTP {error.code}. ' +
                                 ('No TFT EOG available yet.' if error.code == 404 else 'Check/restart the collector after League Client reconnects.'))
            exit_code = 2 if error.code == 404 else 1
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            status.update(captureState='error', message='NO CAPTURE: Cannot reach local LCU or request timed out. Check League Client and lockfile.')
            exit_code = 1
        except Exception as error:
            if status['captureState'] == 'captured':
                status.update(deliveryState='error', deliveryError=type(error).__name__,
                              message=status['message'] + ' Relay queue failed; check server_url and local write permissions.')
            else:
                status.update(captureState='error', message=f'NO CAPTURE: {type(error).__name__}. Check config, EOG response and local write permissions.')
            exit_code = 1
        print(f"[{status['checkedAt']}] {status['message']}", flush=True)
        if not args.capture_only:
            for file in sorted(pending.glob('*.json'), key=lambda item: item.stat().st_mtime):
                try:
                    queued = json.loads(file.read_text(encoding='utf-8'))
                    if queued['serverUrl'] != server_url(config):
                        status.update(deliveryState='blocked', deliveryError='destination_changed')
                        print(f'BLOCKED: {file.stem} belongs to a different server. Restore its original server_url.', flush=True)
                        continue
                    envelope = queued['capture']
                    receipt = relay_request(config, '/api/player-relay/v1/captures', envelope)
                    received_at = receipt.get('receivedAt')
                    if receipt.get('captureId') != envelope['captureId'] or receipt.get('status') not in ('stored', 'duplicate') or not isinstance(received_at, str):
                        raise ValueError('Receiver did not acknowledge the matching capture')
                    datetime.fromisoformat(received_at.replace('Z', '+00:00'))
                    sent[envelope['gameId']] = envelope['payloadSha256']
                    write_atomic(sent_path, json.dumps(sent).encode())
                    file.unlink()
                    status.update(deliveryState='sent', lastSentGameId=envelope['gameId'], captureId=envelope['captureId'], receivedAt=received_at)
                    print(f"SERVER ACKNOWLEDGED: game {envelope['gameId']}, capture {envelope['captureId']}, {received_at}", flush=True)
                except Exception as error:
                    code = f'HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else type(error).__name__
                    status.update(deliveryState='retrying', deliveryError=code)
                    print(f'UPLOAD NOT CONFIRMED: game {file.stem}, {code}. Local file retained; retrying.', flush=True)
                    break
            status['pendingCount'] = sum(1 for _ in pending.glob('*.json'))
        write_atomic(ROOT / 'status.json', json.dumps(status, ensure_ascii=False, indent=2).encode('utf-8'))
        if args.once:
            return exit_code
        time.sleep(max(2, float(config.get('poll_seconds', 3))))


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except KeyboardInterrupt:
        print('Stopped')
