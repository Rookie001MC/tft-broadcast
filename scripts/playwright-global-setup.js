import { preview } from 'vite';

import {
	createFakeTftMatchGateway,
	readFakeTftMatchGatewayCounter,
	resetFakeTftMatchGatewayCounter
} from '../tests/fixtures/fake-tft-match-gateway.js';

const PROVIDER = Symbol.for('tft-match-v1.gateway-factory');
const HOST = '127.0.0.1';
const PORT = 4173;

process.env.RIOT_API_KEY = '';
delete globalThis[PROVIDER];

function isLoopback(address) {
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export default async function globalSetup() {
	let activeServer;
	/** @type {'disabled' | 'restarting' | 'enabled'} */
	let mode = 'disabled';
	/** @type {Promise<void> | null} */
	let restartPromise = null;
	/** @type {unknown} */
	let restartError = null;

	function controlPlugin() {
		return {
			name: 'e2e-tft-match-control',
			configurePreviewServer(server) {
				server.middlewares.use((request, response, next) => {
					if (!request.url?.startsWith('/__e2e/')) return next();
					if (!isLoopback(request.socket.remoteAddress)) {
						response.statusCode = 403;
						return response.end();
					}
					if (request.method === 'GET' && request.url === '/__e2e/tft-match-mode') {
						response.setHeader('Content-Type', 'application/json');
						return response.end(JSON.stringify({ mode }));
					}
					if (request.method === 'POST' && request.url === '/__e2e/enable-tft-match') {
						if (mode !== 'disabled') {
							response.statusCode = 409;
							return response.end();
						}
						mode = 'restarting';
						response.statusCode = 202;
						response.once('finish', () => {
							restartPromise = (async () => {
								await activeServer.close();
								resetFakeTftMatchGatewayCounter();
								globalThis[PROVIDER] = createFakeTftMatchGateway;
								process.env.RIOT_API_KEY = 'e2e-invalid-key-never-sent';
								activeServer = await preview({
									plugins: [controlPlugin()],
									preview: { host: HOST, port: PORT, strictPort: true }
								});
								mode = 'enabled';
							})();
							restartPromise.catch((error) => {
								restartError = error;
							});
						});
						return response.end();
					}
					response.statusCode = 404;
					return response.end();
				});
			}
		};
	}

	activeServer = await preview({
		plugins: [controlPlugin()],
		preview: { host: HOST, port: PORT, strictPort: true }
	});

	return async () => {
		if (restartPromise) await restartPromise.catch(() => undefined);
		await activeServer?.close();
		const count = readFakeTftMatchGatewayCounter();
		delete globalThis[PROVIDER];
		process.env.RIOT_API_KEY = '';
		if (restartError) throw restartError;
		if (mode === 'enabled' && count !== 1) {
			throw new Error(`Expected exactly one fake TFT history call, received ${count}`);
		}
	};
}
