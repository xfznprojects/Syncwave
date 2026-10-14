import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const pagesConfig = JSON.parse(readFileSync(new URL('../pages/wrangler.jsonc', import.meta.url), 'utf8'));
// --force selects actual Pages; recent Wrangler versions redirect agent calls to Workers.
execFileSync(process.execPath, [root + 'node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', 'public', '--project-name', pagesConfig.name, '--branch', 'main', '--force'], {
  cwd: root + 'pages', stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.account_id },
});
