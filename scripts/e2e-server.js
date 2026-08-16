import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { build } from 'vite';

process.env.RIOT_API_KEY = '';

process.env.DATABASE_URL ??= 'file:test-e2e.db';
process.env.MEDIA_ROOT ??= 'media/e2e';
process.env.ORIGIN ??= 'http://127.0.0.1:4173';
process.env.BETTER_AUTH_SECRET ??= 'e2e-only-secret-with-at-least-32-characters';

const client = createClient({ url: process.env.DATABASE_URL });
await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
client.close();

await build();
