const axios = require('axios');
const nodemailer = require('nodemailer');
const { otpTemplate } = require('./emailTemplates');

const MAIL_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) || 30000;

// Parse "Name <email@domain.com>" or plain "email@domain.com" into { name, email }
function parseFrom(raw) {
  const fallback = { name: 'TwinSoul', email: 'no-reply@twinsoul.app' };
  if (!raw) return fallback;
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1] || fallback.name, email: match[2].trim() };
  }
  return { name: fallback.name, email: raw.trim() };
}

// --- Primary path: SendGrid HTTP API (port 443, never blocked by Render) ---
async function sendViaSendGrid({ from, to, subject, html }) {
  const { name, email } = parseFrom(from);
  await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: to }] }],
      from: { email, name },
      subject,
      content: [{ type: 'text/html', value: html }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: MAIL_TIMEOUT_MS,
    }
  );
  return { accepted: [to], provider: 'sendgrid' };
}

// --- Fallback path: SMTP / Ethereal (for local development only) ---
let transporterPromise = null;

async function buildTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: MAIL_TIMEOUT_MS,
      greetingTimeout: MAIL_TIMEOUT_MS,
      socketTimeout: MAIL_TIMEOUT_MS,
    });
    await transporter.verify();
    console.log('Mailer: using SMTP host', process.env.SMTP_HOST);
    return transporter;
  }

  console.warn('SMTP config missing; falling back to Ethereal test account');
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });
}

async function sendViaSmtp(mailOptions) {
  // Lazy + self-healing: if a previous attempt failed, retry building next time
  if (!transporterPromise) {
    transporterPromise = buildTransporter().catch((err) => {
      transporterPromise = null; // allow a fresh attempt on the next call
      throw err;
    });
  }
  const transporter = await transporterPromise;
  const info = await transporter.sendMail(mailOptions);
  const preview = nodemailer.getTestMessageUrl && nodemailer.getTestMessageUrl(info);
  if (preview) console.log('OTP email preview URL:', preview);
  return info;
}

module.exports = {
  sendOtpEmail: async (to, otp, name) => {
    const from = process.env.EMAIL_FROM || 'TwinSoul <no-reply@twinsoul.app>';
    const subject = 'Your TwinSoul OTP';
    const html = otpTemplate(otp, name);

    try {
      if (process.env.SENDGRID_API_KEY) {
        return await sendViaSendGrid({ from, to, subject, html });
      }
      return await sendViaSmtp({ from, to, subject, html });
    } catch (err) {
      // Surface SendGrid's response body so the real reason is visible in logs
      if (err.response && err.response.data) {
        console.error('Failed to send OTP email (SendGrid):', JSON.stringify(err.response.data));
      } else {
        console.error('Failed to send OTP email:', err.message || err);
      }
      throw err;
    }
  },
};
