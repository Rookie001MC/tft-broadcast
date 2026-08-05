import { preview } from 'vite';

export default async function globalSetup() {
	const server = await preview({ preview: { host: '127.0.0.1', port: 4173 } });
	return async () => {
		await server.close();
	};
}
