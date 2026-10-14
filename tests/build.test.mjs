import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

test('browser entry point has valid local imports and exports', async () => {
  // Three.js is already supplied by the existing browser import map.
  await build({ entryPoints: ['js/app.js'], bundle: true, write: false, format: 'esm', external: ['three', 'three/*'], logLevel: 'silent' });
});

test('build is repeatable, escapes public keys and publishes only public assets', () => {
  const source = readFileSync('js/config.js', 'utf8');
  for (const key of ['first-key', "second'key\\with\nnewline"]) {
    execFileSync(process.execPath, ['build.js'], { env: { ...process.env, AUDIUS_API_KEY: key, AUDIUS_API_SECRET: 'never-publish-this-secret', TENOR_API_KEY: 'test-tenor' } });
    const built = readFileSync('dist/js/config.js', 'utf8');
    assert.ok(built.includes(JSON.stringify(key)));
    assert.ok(!built.includes('never-publish-this-secret'));
    assert.equal(readFileSync('js/config.js', 'utf8'), source);
  }
  assert.deepEqual(readdirSync('dist').sort(), ['css', 'index.html', 'js']);
  assert.ok(!readFileSync('dist/index.html', 'utf8').includes('@supabase'));
});
