import { SMTPClient } from 'npm:emailjs@4.0.3';

export interface SmtpConfig {
  host: string;
  port?: number;
  fromName?: string;
  fromEmail: string;
  auth?: { user?: string };
}

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, string>,
  ): Promise<{ data: string | null; error: unknown }>;
}

function safeHeader(value: string, errorCode: string): string {
  if (/\r|\n/.test(value)) throw new Error(errorCode);
  return value;
}

export async function loadSmtpPassword(
  client: RpcClient,
  orgId: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_org_smtp_secret', { p_org_id: orgId });
  if (error || !data) throw new Error('smtp_not_configured');
  return data;
}

export async function sendHtmlEmail(input: {
  config: SmtpConfig;
  password: string;
  orgName: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const port = input.config.port || 465;
  const client = new SMTPClient({
    host: input.config.host,
    port,
    ssl: port === 465,
    user: input.config.auth?.user,
    password: input.password,
  });
  const fromName = safeHeader(
    input.config.fromName || input.orgName,
    'invalid_smtp_from_name',
  );

  await client.sendAsync({
    from: `"${fromName}" <${safeHeader(input.config.fromEmail, 'invalid_smtp_from_email')}>`,
    to: safeHeader(input.to, 'invalid_smtp_recipient'),
    subject: safeHeader(input.subject, 'invalid_smtp_subject'),
    attachment: [{ data: input.html, alternative: true }],
  });
}
