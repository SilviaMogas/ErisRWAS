import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('metadata describes the prototype without regulatory approval claims', () => {
  const description = read('./index.html').match(/<meta name="description" content="([^"]+)"/)[1];
  assert.match(description, /prototype/);
  assert.doesNotMatch(description, /SEC-compliant|certified|approved/i);
});

test('private and authentication routes have an explicit noindex response policy', () => {
  const config = JSON.parse(read('./vercel.json'));
  const rule = config.headers.find(({ source }) =>
    source === '/:section(login|login-simple|register|role-selection|dashboard|marketplace|property|academy)/:path*');
  assert.ok(rule);
  assert.deepEqual(rule.headers, [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }]);
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
});
