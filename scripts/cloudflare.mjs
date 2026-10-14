import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (args, capture = false) => execFileSync(process.execPath, [wrangler, ...args], {
  cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
});

try {
  const mode = process.argv[2];
  if (!['setup', 'deploy'].includes(mode)) throw new Error('Use setup or deploy.');
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (mode === 'deploy') {
    if (!process.env.AUDIUS_API_KEY?.trim()) {
      throw new Error('Set AUDIUS_API_KEY in the Cloudflare build environment (or local .env) before deployment.');
    }
    execFileSync(process.execPath, ['build.js'], { stdio: 'inherit' });
  }
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const binding = config.d1_databases.find(db => db.binding === 'DB');
  if (!binding) throw new Error('Missing DB binding in wrangler.jsonc.');
  if (!binding.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(binding.database_id)) {
    let databases = JSON.parse(run(['d1', 'list', '--json'], true));
    let database = databases.find(db => db.name === binding.database_name);
    if (!database) {
      run(['d1', 'create', binding.database_name]);
      databases = JSON.parse(run(['d1', 'list', '--json'], true));
      database = databases.find(db => db.name === binding.database_name);
    }
    if (!database?.uuid) throw new Error('Could not resolve D1 database ID.');
    binding.database_id = database.uuid;
    writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
  }
  run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  if (mode === 'deploy') run(['deploy']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
