import { AuthError, getBearerToken, verifyPrivyAccessToken } from '../../server/privyAuth.ts';

// KYC verification endpoint - proxies to Persona or other KYC service
const INQUIRY_ID_PATTERN = /^inq_[A-Za-z0-9]{1,64}$/;

interface ApiRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

type InquiryAttributes = Record<string, unknown>;

function getInquiryOwner(attributes: InquiryAttributes): unknown {
  return attributes['reference-id'] ?? attributes.reference_id;
}

export async function POST(req: ApiRequest, res: ApiResponse) {
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyVerificationKey = process.env.PRIVY_VERIFICATION_KEY;
  const kycServiceUrl = process.env.KYC_SERVICE_URL;
  const personaApiKey = process.env.PERSONA_API_KEY;

  if (!privyAppId || !privyVerificationKey || !kycServiceUrl || !personaApiKey) {
    return res.status(503).json({ error: 'KYC verification is not configured' });
  }

  let callerId: string;
  try {
    callerId = verifyPrivyAccessToken(getBearerToken(req.headers.authorization), {
      appId: privyAppId,
      verificationKey: privyVerificationKey
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    throw error;
  }

  const body = (req.body ?? {}) as { inquiryId?: unknown };
  const inquiryId = body.inquiryId;
  if (typeof inquiryId !== 'string' || !INQUIRY_ID_PATTERN.test(inquiryId)) {
    return res.status(400).json({ error: 'Invalid inquiryId' });
  }

  try {
    const kycResponse = await fetch(`${kycServiceUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${personaApiKey}`,
        'Persona-Version': '2023-01-05'
      },
      body: JSON.stringify({
        inquiry_id: inquiryId,
        user_id: callerId
      })
    });

    if (!kycResponse.ok) {
      console.error('KYC provider error:', kycResponse.status);
      return kycResponse.status >= 500
        ? res.status(502).json({ error: 'KYC verification failed' })
        : res.status(404).json({ error: 'KYC inquiry not found' });
    }

    const kycData = await kycResponse.json();
    const attributes: InquiryAttributes | undefined = kycData?.data?.attributes;

    // Only return inquiries created for the authenticated caller (Persona reference ID).
    if (!attributes || getInquiryOwner(attributes) !== callerId) {
      return res.status(404).json({ error: 'KYC inquiry not found' });
    }

    return res.status(200).json({
      success: true,
      status: attributes.status,
      verificationLevel: attributes.name_first ? 'verified' : 'pending',
      completedAt: attributes.completed_at
    });
  } catch (error) {
    console.error('KYC API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
