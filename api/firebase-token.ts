import { exchangePrivyTokenForFirebaseToken, TokenExchangeError } from '../server/firebaseCustomToken';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const token = await exchangePrivyTokenForFirebaseToken(request.headers.get('authorization'));
    return new Response(JSON.stringify({ token }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    const status = error instanceof TokenExchangeError ? error.status : 500;
    const message = error instanceof TokenExchangeError ? error.message : 'Token exchange failed';
    if (status >= 500) console.error('Firebase token exchange failed:', error);
    return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
  }
}
