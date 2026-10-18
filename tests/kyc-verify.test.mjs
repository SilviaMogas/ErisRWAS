import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { POST } from '../src/api/kyc/verify.ts';

const APP_ID = 'test-privy-app';
const CALLER = 'did:privy:caller';
const VICTIM = 'did:privy:victim';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeToken(overrides = {}, { key = privateKey, alg = 'ES256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg, typ: 'JWT' });
  const payload = b64({ iss: 'privy.io', aud: APP_ID, sub: CALLER, iat: now, exp: now + 600, ...overrides });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function mockRes() {
  return {
    statusCode: 0,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

let upstreamCalls;
let upstreamOwner;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.PRIVY_APP_ID = APP_ID;
  process.env.PRIVY_VERIFICATION_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '\\n');
  process.env.KYC_SERVICE_URL = 'https://kyc.invalid';
  process.env.PERSONA_API_KEY = 'test-key';
  upstreamCalls = [];
  upstreamOwner = CALLER;
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      data: { attributes: { status: 'approved', 'reference-id': upstreamOwner, name_first: 'A', completed_at: '2026-01-01T00:00:00Z' } }
    }), { status: 200 });
  };
});

afterEach(() => { globalThis.fetch = originalFetch; });

async function call(authorization, body = { inquiryId: 'inq_abc123' }) {
  const res = mockRes();
  await POST({ headers: authorization === undefined ? {} : { authorization }, body }, res);
  return res;
}

test('rejects missing, arbitrary and malformed Authorization headers', async () => {
  for (const header of [undefined, 'x', 'Bearer x', 'Bearer a.b.c']) {
    const res = await call(header);
    assert.equal(res.statusCode, 401, String(header));
  }
  assert.equal(upstreamCalls.length, 0);
});

test('rejects forged, unsigned, expired and foreign-app tokens', async () => {
  const cases = [
    makeToken({}, { key: other.privateKey }),
    makeToken({}, { alg: 'none' }),
    makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    makeToken({ aud: 'another-app' }),
    makeToken({ iss: 'evil.example' })
  ];
  for (const token of cases) {
    const res = await call(`Bearer ${token}`);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(upstreamCalls.length, 0);
});

test('rejects invalid inquiry IDs', async () => {
  const res = await call(`Bearer ${makeToken()}`, { inquiryId: '../admin' });
  assert.equal(res.statusCode, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('uses verified caller identity instead of body userId', async () => {
  const res = await call(`Bearer ${makeToken()}`, { inquiryId: 'inq_abc123', userId: VICTIM });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'approved');
  assert.equal(upstreamCalls[0].body.user_id, CALLER);
});

test('hides inquiries that belong to another user', async () => {
  upstreamOwner = VICTIM;
  const res = await call(`Bearer ${makeToken()}`);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, undefined);
});

test('does not forward upstream error details', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'secret', errors: ['internal'] }), { status: 403 });
  const res = await call(`Bearer ${makeToken()}`);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'KYC inquiry not found' });
});

test('fails closed when not configured', async () => {
  delete process.env.PRIVY_VERIFICATION_KEY;
  const res = await call(`Bearer ${makeToken()}`);
  assert.equal(res.statusCode, 503);
});
