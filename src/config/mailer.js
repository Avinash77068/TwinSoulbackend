const { Resend } = require('resend');
const { otpTemplate } = require('./emailTemplates');

// Resend replaces the old Gmail-SMTP setup — that was getting silently
// blocked because Google flags SMTP logins from cloud/datacenter IPs (Render's
// IP) as suspicious. Resend is a proper transactional email API (no SMTP
// handshake to get blocked) with a real free tier: 3,000 emails/month, 100/day.
const resend = new Resend(process.env.RESEND_API_KEY);

const MAIL_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) || 30000;

const withTimeout = (promise, timeoutMs = MAIL_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Mail send timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

module.exports = {
  sendOtpEmail: async (to, otp, name) => {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('Missing RESEND_API_KEY in environment — cannot send email');
    }

    // Until twinsoul.app is verified in the Resend dashboard (DNS/SPF/DKIM
    // records), Resend's sandbox only allows sending to the account's own
    // signup email — real users' OTP emails will fail with a 403 until then.
    const from = process.env.EMAIL_FROM || 'SoulSync <no-reply@twinsoul.app>';
    const html = otpTemplate(otp, name);

    const { data, error } = await withTimeout(
      resend.emails.send({ from, to, subject: 'Your SoulSync OTP', html }),
    );

    if (error) {
      console.error('Failed to send OTP email:', error);
      throw new Error(error.message || 'Failed to send OTP email');
    }

    return data;
  },
};
