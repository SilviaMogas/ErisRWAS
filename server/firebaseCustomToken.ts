import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const PRIVY_ISSUER = 'privy.io';
const FIREBASE_UID_MAX_LENGTH = 128;

let privyKeySet: JWTVerifyGetKey | undefined;

export class TokenExchangeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function privyAppId(): string {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID;
  if (!appId) throw new TokenExchangeError('Privy is not configured', 500);
  return appId;
}

function getPrivyKeySet(appId: string): JWTVerifyGetKey {
  privyKeySet ??= createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`)
  );
  return privyKeySet;
}

export async function verifyPrivyAccessToken(
  accessToken: string,
  appId: string,
  keySet: JWTVerifyGetKey
): Promise<string> {
  try {
    const { payload } = await jwtVerify(accessToken, keySet, {
      issuer: PRIVY_ISSUER,
      audience: appId,
      algorithms: ['ES256'],
    });
    const uid = payload.sub;
    if (!uid || !uid.startsWith('did:privy:') || uid.length > FIREBASE_UID_MAX_LENGTH) {
      throw new Error('Unexpected subject');
    }
    return uid;
  } catch {
    throw new TokenExchangeError('Invalid Privy access token', 401);
  }
}

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new TokenExchangeError('Firebase Admin is not configured', 500);
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function bearerToken(authorization: string | null): string {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new TokenExchangeError('Missing bearer token', 401);
  return match[1];
}

export async function exchangePrivyTokenForFirebaseToken(authorization: string | null): Promise<string> {
  const accessToken = bearerToken(authorization);
  const appId = privyAppId();
  const uid = await verifyPrivyAccessToken(accessToken, appId, getPrivyKeySet(appId));
  return getAuth(getAdminApp()).createCustomToken(uid);
}
