exports.otpTemplate = (otp, name) => {
  const displayName = name || '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.4;">
    <h2 style="color:#7b2cbf">TwinSoul — One Time Password (OTP)</h2>
    <p>Hi ${displayName},</p>
    <p>Your verification code is:</p>
    <div style="font-size:22px;font-weight:700;margin:16px 0;padding:12px 16px;background:#f7f2fb;border-radius:6px;display:inline-block">${otp}</div>
    <p>This code will expire in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    <hr />
    <p style="font-size:12px;color:#666">Thanks — The TwinSoul Team</p>
  </div>
  `;
};
