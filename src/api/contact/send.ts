import { Resend } from 'resend';

const USER_TYPES = ['investor', 'originator', 'general'] as const;
type UserType = (typeof USER_TYPES)[number];

const FIELD_LIMITS = {
  name: 100,
  email: 254,
  company: 120,
  phone: 40,
  subject: 150,
  message: 5000
} as const;

const EMAIL_REGEX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_CLIENT = 5;
const RATE_LIMIT_GLOBAL = 50;
const requestLog = new Map<string, number[]>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

function readField(body: Record<string, unknown>, key: keyof typeof FIELD_LIMITS, required: boolean): string | null | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    return required ? null : undefined;
  }
  if (typeof raw !== 'string') return null;
  const value = key === 'message' ? raw.trim() : singleLine(raw);
  if ((required && !value) || value.length > FIELD_LIMITS[key]) return null;
  return value || undefined;
}

function isRateLimited(clientKey: string, now: number): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (key: string) => (requestLog.get(key) ?? []).filter((t) => t > windowStart);

  const global = recent('*');
  const client = recent(clientKey);
  if (global.length >= RATE_LIMIT_GLOBAL || client.length >= RATE_LIMIT_PER_CLIENT) {
    requestLog.set('*', global);
    requestLog.set(clientKey, client);
    return true;
  }
  requestLog.set('*', [...global, now]);
  requestLog.set(clientKey, [...client, now]);

  for (const [key, times] of requestLog) {
    if (!times.some((t) => t > windowStart)) requestLog.delete(key);
  }
  return false;
}

interface ApiRequest {
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
  setHeader?(name: string, value: string): unknown;
}

function errorResponse(res: ApiResponse, status: number, message: string) {
  return res.status(status).json({ error: message, message });
}

export async function POST(req: ApiRequest, res: ApiResponse) {
  try {
    const clientKey = String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
    if (isRateLimited(clientKey, Date.now())) {
      res.setHeader?.('Retry-After', String(RATE_LIMIT_WINDOW_MS / 1000));
      return errorResponse(res, 429, 'Too many messages. Please try again later.');
    }

    const body: Record<string, unknown> =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const name = readField(body, 'name', true);
    const email = readField(body, 'email', true);
    const subject = readField(body, 'subject', true);
    const message = readField(body, 'message', true);
    const company = readField(body, 'company', false);
    const phone = readField(body, 'phone', false);

    if (!name || !email || !subject || !message || company === null || phone === null) {
      return errorResponse(
        res,
        400,
        'Missing or invalid fields: name, email, subject, and message are required and must be within length limits'
      );
    }

    if (!EMAIL_REGEX.test(email)) {
      return errorResponse(res, 400, 'Invalid email format');
    }

    const userType: UserType = USER_TYPES.includes(body.userType as UserType)
      ? (body.userType as UserType)
      : 'general';

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('Contact form: RESEND_API_KEY is not configured');
      return errorResponse(res, 500, 'Email service is not configured. Please try again later.');
    }

    const resend = new Resend(apiKey);

    const templateNames: Record<UserType, string> = {
      investor: 'Investor Inquiry',
      originator: 'Asset Originator Inquiry',
      general: 'General Inquiry'
    };
    const emailConfig = {
      to: ['silviam@bmbweb3.com', 'julio.cruz@eb-ms.net'],
      replyTo: email,
      templateName: templateNames[userType]
    };
    const userTypeLabel = userType.charAt(0).toUpperCase() + userType.slice(1);

    const emailSubject = `[${emailConfig.templateName}] ${subject}`;

    const safe = {
      name: escapeHtml(name),
      email: escapeHtml(email),
      mailto: escapeHtml(encodeURIComponent(email).replace(/%40/g, '@')),
      company: company ? escapeHtml(company) : '',
      phone: phone ? escapeHtml(phone) : '',
      subject: escapeHtml(subject),
      message: escapeHtml(message).replace(/\r?\n/g, '<br>')
    };

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Contact Form Submission</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; margin: -30px -30px 30px -30px; }
            .header h1 { margin: 0; font-size: 24px; }
            .field { margin-bottom: 15px; }
            .label { font-weight: bold; color: #555; margin-bottom: 5px; display: block; }
            .value { background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #e9ecef; }
            .message-content { background: #fff; padding: 15px; border-left: 4px solid #667eea; margin: 15px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; font-size: 12px; color: #666; }
            .urgent { color: #dc3545; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🌟 ErisRWA Contact Form</h1>
              <p>${emailConfig.templateName}</p>
            </div>
            
            <div class="field">
              <span class="label">👤 Name:</span>
              <div class="value">${safe.name}</div>
            </div>
            
            <div class="field">
              <span class="label">📧 Email:</span>
              <div class="value"><a href="mailto:${safe.mailto}">${safe.email}</a></div>
            </div>
            
            ${company ? `
              <div class="field">
                <span class="label">🏢 Company:</span>
                <div class="value">${safe.company}</div>
              </div>
            ` : ''}
            
            ${phone ? `
              <div class="field">
                <span class="label">📞 Phone:</span>
                <div class="value">${safe.phone}</div>
              </div>
            ` : ''}
            
            <div class="field">
              <span class="label">👥 User Type:</span>
              <div class="value">${userTypeLabel}</div>
            </div>
            
            <div class="field">
              <span class="label">📋 Subject:</span>
              <div class="value">${safe.subject}</div>
            </div>
            
            <div class="field">
              <span class="label">💬 Message:</span>
              <div class="message-content">${safe.message}</div>
            </div>
            
            <div class="footer">
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Source:</strong> ErisRWA Contact Form</p>
              <p class="urgent">⚡ Please respond within 24 hours for investor inquiries</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const textContent = `
ErisRWA Contact Form Submission

Name: ${name}
Email: ${email}
${company ? `Company: ${company}` : ''}
${phone ? `Phone: ${phone}` : ''}
User Type: ${userTypeLabel}
Subject: ${subject}

Message:
${message}

Submitted: ${new Date().toLocaleString()}
Source: ErisRWA Contact Form
    `;

    // Send email to team (including silviam@bmbweb3.com)
    const { data: teamEmailData, error: teamEmailError } = await resend.emails.send({
      from: 'ErisRWA Contact <noreply@erisrwa.com>',
      to: emailConfig.to,
      replyTo: emailConfig.replyTo,
      subject: emailSubject,
      html: emailHtml,
      text: textContent,
      tags: [
        {
          name: 'category',
          value: 'contact-form'
        },
        {
          name: 'user-type',
          value: userType
        }
      ]
    });

    if (teamEmailError) {
      console.error('Contact form: Resend team email error:', teamEmailError.name);
      return errorResponse(res, 500, 'Failed to send email to team. Please try again later.');
    }

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      teamEmailId: teamEmailData?.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Contact form API error:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ 
      error: 'Internal server error. Please try again later.',
      timestamp: new Date().toISOString()
    });
  }
}