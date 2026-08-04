const axios = require('axios');
const { otpTemplate } = require('./emailTemplates');

// Brevo transactional email API. Gmail SMTP silently blocked cloud/datacenter
// IPs (Render's); Resend's free tier only sends to the account's own signup
// address until a domain is DNS-verified. Brevo needs just one verified
// sender email (a Gmail address works) and gives 300 emails/day free.
const MAIL_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) || 30000;

const withTimeout = (promise, timeoutMs = MAIL_TIMEOUT_MS) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Mail send timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
    // clearTimeout matters here: an uncleared 30s timer keeps the event loop
    // handle alive after a fast send, which stalls short-lived scripts on exit.
  ]).finally(() => clearTimeout(timer));
};

// EMAIL_FROM may be either "no-reply@x.com" or "SoulSync <no-reply@x.com>".
// Brevo's API wants the name and address as separate fields.
const parseFrom = () => {
  const raw = process.env.EMAIL_FROM || 'SoulSync <no-reply@soulsync.app>';
  const match = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return match
    ? { name: match[1] || 'SoulSync', email: match[2].trim() }
    : { name: 'SoulSync', email: raw.trim() };
};

module.exports = {
  sendOtpEmail: async (to, otp, name) => {
    if (!process.env.BREVO_API_KEY) {
      throw new Error('Missing BREVO_API_KEY in environment — cannot send email');
    }

    const sender = parseFrom();
    const html = otpTemplate(otp, name);

    try {
      const { data } = await withTimeout(
        axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender,
            to: [{ email: to, ...(name ? { name } : {}) }],
            subject: 'Your SoulSync OTP',
            htmlContent: html,
          },
          {
            headers: {
              'api-key': process.env.BREVO_API_KEY,
              'Content-Type': 'application/json',
              accept: 'application/json',
            },
            timeout: MAIL_TIMEOUT_MS,
          },
        ),
      );
      return data;
    } catch (err) {
      // Brevo returns { code, message } — surface it instead of a bare 400.
      const detail = err.response?.data?.message || err.message;
      console.error('Brevo send failed:', err.response?.data || err.message);
      throw new Error(`Failed to send OTP email: ${detail}`);
    }
  },
};
