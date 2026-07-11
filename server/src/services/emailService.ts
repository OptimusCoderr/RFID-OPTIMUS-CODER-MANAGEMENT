import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  if (!env.smtp.host || !env.smtp.user || !env.smtp.password) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  });
  return transporter;
}

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Falls back to logging the message to the console when SMTP isn't configured,
// so password reset and other transactional flows still work in local dev.
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getTransporter();

  if (!client) {
    // eslint-disable-next-line no-console
    console.log(`\n[email:dev-fallback] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}\n`);
    return;
  }

  await client.sendMail({ from: env.smtp.from, to: input.to, subject: input.subject, text: input.text, html: input.html });
}
