import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import { decryptCreds, getEmailAccount, type EmailAccountCreds } from './account.js';

export class EmailError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = 'EmailError';
  }
}

function buildTransport(creds: EmailAccountCreds): Transporter {
  const { smtp } = creds;
  if (!smtp.host || !smtp.port) {
    throw new EmailError('smtp_misconfigured', 'SMTP host/port not set on email account');
  }
  const secure = smtp.security === 'ssl';
  const requireTLS = smtp.security === 'starttls';

  if (smtp.oauth_access_token) {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure,
      requireTLS,
      auth: {
        type: 'OAuth2',
        user: smtp.username,
        accessToken: smtp.oauth_access_token,
      },
    });
  }
  if (smtp.password) {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure,
      requireTLS,
      auth: { user: smtp.username, pass: smtp.password },
    });
  }
  throw new EmailError('smtp_no_credentials', 'neither OAuth token nor password configured');
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  /** Optional HTML body. If absent we send text-only. */
  html?: string;
  /** Optional Reply-To override; defaults to the configured from address. */
  replyTo?: string;
}

export interface SendEmailResult {
  message_id: string;
  accepted: string[];
  rejected: string[];
  response: string;
  latency_ms: number;
}

/**
 * Send an email through the user's own SMTP server (via password or OAuth XOAUTH2).
 * The send goes through the user's real account, so the sent message also lands
 * in their own Sent folder — no separate transactional-sender identity.
 */
export async function sendEmail(userId: number, opts: SendEmailOptions): Promise<SendEmailResult> {
  const row = getEmailAccount(userId);
  if (!row) throw new EmailError('no_email_account', 'no email_accounts row for this user');
  const creds = decryptCreds(row);

  const transport = buildTransport(creds);
  const mail: SendMailOptions = {
    from: creds.email_address,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    html: opts.html,
    replyTo: opts.replyTo,
  };

  const t0 = Date.now();
  try {
    const info = await transport.sendMail(mail);
    return {
      message_id: info.messageId,
      accepted: (info.accepted as string[]) ?? [],
      rejected: (info.rejected as string[]) ?? [],
      response: info.response ?? '',
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    throw normalizeError(err);
  } finally {
    transport.close();
  }
}

/**
 * Send a quick test email to a target address. Used by the dashboard's
 * Integrations → Email "Test send" button.
 */
export async function sendTestEmail(userId: number, to: string): Promise<SendEmailResult> {
  return sendEmail(userId, {
    to,
    subject: 'VOX · Email test',
    body: 'This is a test email from VOX, your voice-first messaging companion for the Even Realities G2. If you can read this, SMTP is working.',
  });
}

function normalizeError(err: unknown): EmailError {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    const code =
      e.code === 'EAUTH' ? 'smtp_auth_failed' :
      e.code === 'ECONNECTION' ? 'smtp_connection_failed' :
      e.code === 'ETIMEDOUT' ? 'smtp_timeout' :
      e.code === 'EMESSAGE' ? 'smtp_message_rejected' :
      'smtp_unknown';
    return new EmailError(code, e.message ?? 'smtp request failed', e.responseCode);
  }
  if (err instanceof Error) return new EmailError('smtp_unknown', err.message);
  return new EmailError('smtp_unknown', String(err));
}
