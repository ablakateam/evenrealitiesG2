import { simpleParser, type AddressObject } from 'mailparser';
import { sanitizeForHud } from '../sms/sanitize.js';

export interface ParsedInbound {
  message_id: string;
  uid: number;
  from_address: string;
  from_name: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  date_received: string;
  size_bytes: number;
}

/**
 * Parse a raw RFC822 email message into the inbox row shape.
 * `bodyText` is sanitized for HUD display; `body_html` is preserved for the
 * dashboard's full-thread view. Raw payload stays in inbox.raw_payload_json.
 */
export async function parseRawEmail(raw: Buffer, uid: number): Promise<ParsedInbound> {
  const parsed = await simpleParser(raw);

  const fromObj = parsed.from as AddressObject | undefined;
  const fromEntry = fromObj?.value?.[0];
  const fromAddress = fromEntry?.address ?? '';
  const fromName = fromEntry?.name?.trim() || null;

  const bodyText = parsed.text ?? '';
  const sanitized = sanitizeForHud(bodyText.split(/\n--+\s*\n/)[0] ?? bodyText); // strip quoted reply tails best-effort

  return {
    message_id: parsed.messageId ?? `imap-uid-${uid}`,
    uid,
    from_address: fromAddress,
    from_name: fromName,
    subject: parsed.subject?.trim() ?? '',
    body_text: sanitized,
    body_html: parsed.html || null,
    date_received: (parsed.date ?? new Date()).toISOString(),
    size_bytes: raw.length,
  };
}
