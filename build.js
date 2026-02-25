#!/usr/bin/env node
// Build script: replaces __PLACEHOLDER__ values in js/config.js with environment variables.
// Reads from process.env (Netlify injects these) or from a local .env file.

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

const configPath = path.join(__dirname, 'js', 'config.js');
let config = fs.readFileSync(configPath, 'utf8');

const replacements = {
  '__AUDIUS_API_KEY__': process.env.AUDIUS_API_KEY || '',
  '__SUPABASE_URL__': process.env.SUPABASE_URL || '',
  '__SUPABASE_ANON_KEY__': process.env.SUPABASE_ANON_KEY || '',
  '__TENOR_API_KEY__': process.env.TENOR_API_KEY || '',
};

for (const [placeholder, value] of Object.entries(replacements)) {
  config = config.replace(placeholder, value);
}

fs.writeFileSync(configPath, config, 'utf8');

console.log('Build complete — config.js updated with environment variables.');
const keys = Object.entries(replacements).map(([k, v]) => `  ${k}: ${v ? 'set' : 'MISSING'}`);
console.log(keys.join('\n'));
