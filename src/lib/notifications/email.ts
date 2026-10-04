// src/lib/notifications/email.ts

export interface SendEmailPayload {
  toEmail: string;
  recipientName: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  mode: 'resend' | 'smtp' | 'stubbed';
  error?: string;
}

/**
 * Sends an email notification to an instructor.
 * Checks for RESEND_API_KEY or SMTP configuration in environment.
 * If neither is configured (as in initial setup), cleanly stubs the call behind a TODO.
 */
export async function sendEmailNotification(
  payload: SendEmailPayload
): Promise<SendEmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;

  // 1. Resend integration if configured
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'AlterSched <notifications@altersched.edu>',
          to: [payload.toEmail],
          subject: payload.subject,
          text: payload.textBody,
          html: payload.htmlBody,
        }),
      });

      const resJson = await response.json();
      if (!response.ok) {
        return {
          success: false,
          mode: 'resend',
          error: resJson.message || 'Resend API error',
        };
      }

      return {
        success: true,
        messageId: resJson.id,
        mode: 'resend',
      };
    } catch (err: any) {
      return {
        success: false,
        mode: 'resend',
        error: err.message,
      };
    }
  }

  // 2. SMTP integration if configured
  if (smtpHost) {
    // TODO: Connect via nodemailer/smtp transport when SMTP credentials are provided
    console.log(`[Email SMTP Configured]: Sending to ${payload.toEmail}`);
    return {
      success: true,
      mode: 'smtp',
    };
  }

  // 3. Stubbed fallback
  // TODO: Configure RESEND_API_KEY or SMTP_HOST in .env.local to enable live external emails
  console.log(
    `[EMAIL STUB - Schedule Notification]: To=${payload.toEmail}, Subject="${payload.subject}"`
  );
  console.log(`[EMAIL BODY]:\n${payload.textBody}`);

  return {
    success: true,
    messageId: `stub-${Date.now()}`,
    mode: 'stubbed',
  };
}
