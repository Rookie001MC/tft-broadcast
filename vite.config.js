import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import devToolsJson from 'vite-plugin-devtools-json';

function browserTestMediaStub() {
	return {
		name: 'browser-test-media-stub',
		apply: /** @param {unknown} _config @param {{ mode: string }} environment */ (
			_config,
			environment
		) => environment.mode === 'test',
		/** @param {import('vite').ViteDevServer} server */
		configureServer(server) {
			server.middlewares.use(
				'/media/player-images/',
				/**
				 * @param {import('node:http').IncomingMessage} _request
				 * @param {import('node:http').ServerResponse} response
				 */
				(_request, response) => {
					response.statusCode = 404;
					response.end();
				}
			);
		}
	};
}

export default defineConfig({
	optimizeDeps: {
		include: [
			'@lucide/svelte/icons/external-link',
			'@lucide/svelte/icons/eye-off',
			'@lucide/svelte/icons/log-out',
			'@lucide/svelte/icons/radio'
		]
	},
	plugins: [
		devToolsJson(),
		browserTestMediaStub(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter({ precompress: true }),

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.js');
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.js',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.js',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
