import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

spawnSync(process.execPath, ['scripts/stamp-build-info.mjs'], { stdio: 'inherit' });

const server = await createServer({
  configFile: 'vite.config.js',
});
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`[plenum] vite ${url}`);

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, PLENUM_DEV_URL: url },
});

const shutdown = async (code = 0) => {
  child.kill();
  await server.close();
  process.exit(code);
};
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
