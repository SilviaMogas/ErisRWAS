import { createPublicKey, verify as verifySignature } from 'node:crypto';

const PRIVY_ISSUER = 'privy.io';
const CLOCK_SKEW_SECONDS = 30;

export class AuthError extends Error {}

export interface PrivyTokenConfig {
  appId: string;
  verificationKey: string;
  nowSeconds?: number;
}

interface PrivyTokenPayload {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new AuthError('Malformed token');
}

export function getBearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? '');
  if (!match) {
    throw new AuthError('Missing bearer token');
  }
  return match[1];
}

// Verifies a Privy access token (ES256 JWT) and returns the Privy user ID (`sub`).
export function verifyPrivyAccessToken(token: string, config: PrivyTokenConfig): string {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AuthError('Malformed token');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = decodeJsonSegment(encodedHeader);
  if (header.alg !== 'ES256') {
    throw new AuthError('Unsupported token algorithm');
  }

  let validSignature = false;
  try {
    const key = createPublicKey(config.verificationKey.replace(/\\n/g, '\n'));
    validSignature = verifySignature(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSignature, 'base64url')
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    throw new AuthError('Invalid token signature');
  }

  const payload = decodeJsonSegment(encodedPayload) as PrivyTokenPayload;
  const now = config.nowSeconds ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

  if (payload.iss !== PRIVY_ISSUER || !audiences.includes(config.appId)) {
    throw new AuthError('Token not issued for this app');
  }
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS <= now) {
    throw new AuthError('Token expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    throw new AuthError('Token not yet valid');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AuthError('Token has no subject');
  }
  return payload.sub;
}
