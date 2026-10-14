#!/usr/bin/env node
// Publish only public assets. Keep source config intact for repeatable builds.

const fs = require('fs');
const path = require('path');

// Load .env file if it exists (for local dev)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const outputDir = path.join(__dirname, 'dist');
// Refuse to follow a redirected output directory when cleaning generated assets.
if (fs.existsSync(outputDir)) {
  const actual = fs.realpathSync(outputDir);
  const expected = path.join(fs.realpathSync(__dirname), 'dist');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('dist must be inside this project');
  fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(outputDir, 'index.html'));
for (const dir of ['js', 'css']) fs.cpSync(path.join(__dirname, dir), path.join(outputDir, dir), { recursive: true });
let config = fs.readFileSync(path.join(__dirname, 'js', 'config.js'), 'utf8');

const replacements = {
  '__AUDIUS_API_KEY__': process.env.AUDIUS_API_KEY || '',
  '__TENOR_API_KEY__': process.env.TENOR_API_KEY || '',
};

for (const [placeholder, value] of Object.entries(replacements)) {
  config = config.replace(`'${placeholder}'`, JSON.stringify(value));
}

fs.writeFileSync(path.join(outputDir, 'js', 'config.js'), config, 'utf8');

console.log('Build complete — public assets written to dist/.');
const keys = Object.entries(replacements).map(([k, v]) => `  ${k}: ${v ? 'set' : 'MISSING'}`);
console.log(keys.join('\n'));
