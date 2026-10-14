import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

test('browser entry point has valid local imports and exports', async () => {
  // Three.js is already supplied by the existing browser import map.
  await build({ entryPoints: ['js/app.js'], bundle: true, write: false, format: 'esm', external: ['three', 'three/*'], logLevel: 'silent' });
});

test('build is repeatable, escapes public keys and publishes only public assets', t => {
  // Keep test keys and cleanup out of the project's deployment assets.
  const root = mkdtempSync(path.join(tmpdir(), 'syncwave-security-build-'));
  const tempRoot = path.resolve(tmpdir()) + path.sep;
  assert.ok(path.resolve(root).startsWith(tempRoot));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  for (const file of ['build.js', 'index.html', 'js', 'css']) cpSync(file, path.join(root, file), { recursive: true });
  const read = file => readFileSync(path.join(root, file), 'utf8');
  const source = read('js/config.js');
  for (const key of ['first-key', "second'key\\with\nnewline"]) {
    execFileSync(process.execPath, ['build.js'], { cwd: root, env: { ...process.env, AUDIUS_API_KEY: key, AUDIUS_API_SECRET: 'never-publish-this-secret', AUDIUS_BEARER_TOKEN: 'never-publish-this-bearer', TENOR_API_KEY: 'test-tenor' } });
    const built = read('dist/js/config.js');
    assert.ok(built.includes(JSON.stringify(key)));
    assert.ok(!built.includes('never-publish-this-secret'));
    assert.ok(!built.includes('never-publish-this-bearer'));
    assert.equal(read('js/config.js'), source);
  }
  assert.deepEqual(readdirSync(path.join(root, 'dist')).sort(), ['css', 'index.html', 'js']);
  assert.ok(!read('dist/index.html').includes('@supabase'));
});
