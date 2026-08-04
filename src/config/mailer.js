const axios = require('axios');
const { otpTemplate } = require('./emailTemplates');


const PROVIDER = (
  process.env.EMAIL_PROVIDER
  || (process.env.SMTP_USER ? 'smtp' : process.env.BREVO_API_KEY ? 'brevo' : 'resend')
).toLowerCase();

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

// One reused transport — creating a fresh one per email throws away the pooled
// TCP/TLS connection and re-does the auth handshake on every OTP.
let transporter;
const getTransport = () => {
  if (transporter) return transporter;

  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('Missing SMTP_USER / SMTP_PASS in environment — cannot send email');
  }

  const port = Number(process.env.SMTP_PORT) || 587;

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port,
    secure: port === 465, // 587 starts plaintext and upgrades via STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 3,
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });

  return transporter;
};

const sendViaSmtp = async ({ to, subject, html, name }) => {
  const sender = parseFrom();

  try {
    const info = await withTimeout(
      getTransport().sendMail({
        from: { name: sender.name, address: sender.email },
        to: name ? { name, address: to } : to,
        subject,
        html,
      }),
    );
    return info;
  } catch (err) {
    console.error('SMTP send failed:', err.response || err.message);
    throw new Error(`Failed to send OTP email: ${err.response || err.message}`);
  }
};

const sendViaBrevo = async ({ to, subject, html, name }) => {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('Missing BREVO_API_KEY in environment — cannot send email');
  }

  const sender = parseFrom();

  try {
    const { data } = await withTimeout(
      axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender,
          to: [{ email: to, ...(name ? { name } : {}) }],
          subject,
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
};

const sendViaResend = async ({ to, subject, html }) => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY in environment — cannot send email');
  }

  // Lazy require — the brevo path shouldn't die if `resend` isn't installed.
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || 'SoulSync <no-reply@soulsync.app>';

  const { data, error } = await withTimeout(resend.emails.send({ from, to, subject, html }));

  if (error) {
    console.error('Resend send failed:', error);
    throw new Error(error.message || 'Failed to send OTP email');
  }

  return data;
};

module.exports = {
  sendOtpEmail: async (to, otp, name) => {
    const payload = {
      to,
      name,
      subject: 'Your SoulSync OTP',
      html: otpTemplate(otp, name),
    };

    if (PROVIDER === 'smtp') return sendViaSmtp(payload);
    if (PROVIDER === 'brevo') return sendViaBrevo(payload);
    if (PROVIDER === 'resend') return sendViaResend(payload);
    throw new Error(`Unknown EMAIL_PROVIDER "${PROVIDER}" — use "smtp", "brevo" or "resend"`);
  },
};
