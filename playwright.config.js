import { defineConfig } from '@playwright/test';

process.env.RIOT_API_KEY = '';

process.env.DATABASE_URL ??= 'file:test-e2e.db';
process.env.MEDIA_ROOT ??= 'media/e2e';
process.env.ORIGIN ??= 'http://127.0.0.1:4173';
process.env.BETTER_AUTH_SECRET ??= 'e2e-only-secret-with-at-least-32-characters';

export default defineConfig({
	testDir: '.',
	testMatch: ['**/*.e2e.{ts,js}', 'tests/manual-winner-graphics.test.js'],
	fullyParallel: false,
	workers: 1,
	globalSetup: './scripts/playwright-global-setup.js',
	use: { baseURL: 'http://127.0.0.1:4173' }
});
