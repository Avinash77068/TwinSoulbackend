const nodemailer = require('nodemailer');

const MAIL_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) || 30000;

async function createTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      logger: process.env.NODE_ENV !== 'production',
      debug: process.env.NODE_ENV !== 'production',
      connectionTimeout: MAIL_TIMEOUT_MS,
      greetingTimeout: MAIL_TIMEOUT_MS,
      socketTimeout: MAIL_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });

    await transporter.verify();
    return transporter;
  }

  // Fallback to Ethereal for development if no SMTP config provided
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
    logger: process.env.NODE_ENV !== 'production',
    debug: process.env.NODE_ENV !== 'production',
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });

  await transporter.verify();
  return transporter;
}

const transporterPromise = createTransporter();

async function sendMail(mailOptions) {
  const transporter = await transporterPromise;
  return transporter.sendMail(mailOptions);
}

const withTimeout = (promise, timeoutMs = MAIL_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Mail send timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

const { otpTemplate } = require('./emailTemplates');

module.exports = {
  sendOtpEmail: async (to, otp, name) => {
    const from = process.env.EMAIL_FROM || 'TwinSoul <no-reply@twinsoul.app>';
    const html = otpTemplate(otp, name);
    const info = await withTimeout(sendMail({ from, to, subject: 'Your TwinSoul OTP', html }));
    // If using Ethereal, print preview URL
    if (nodemailer.getTestMessageUrl && info) {
      const preview = nodemailer.getTestMessageUrl(info);
      if (preview) console.log('OTP email preview URL:', preview);
    }
    return info;
  },
};
