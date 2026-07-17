const nodemailer = require('nodemailer');

async function createTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Fallback to Ethereal for development if no SMTP config provided
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

const transporterPromise = createTransporter();

async function sendMail(mailOptions) {
  const transporter = await transporterPromise;
  return transporter.sendMail(mailOptions);
}

const withTimeout = (promise, timeoutMs = 10000) =>
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
