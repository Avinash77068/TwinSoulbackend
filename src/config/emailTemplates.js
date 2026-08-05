/**
 * Password-reset code email.
 *
 * Deliberately different copy from the signup OTP: a reset email may arrive
 * unsolicited (someone typed the wrong address, or is probing an account), so it
 * has to tell the recipient plainly that nothing has changed yet and that ignoring
 * it is safe. It also must never include the account's existing password or any
 * other detail — a reset email is sometimes read by the wrong person.
 */
exports.passwordResetTemplate = (otp, name, ttlMinutes = 10) => {
  const displayName = name || 'there';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
    <h2 style="color:#7b2cbf;margin:0 0 16px">SoulSync — Reset your password</h2>
    <p>Hi ${displayName},</p>
    <p>Use this code to reset your password:</p>
    <div style="font-size:26px;font-weight:700;letter-spacing:4px;margin:18px 0;padding:14px 20px;background:#f7f2fb;border-radius:8px;display:inline-block">${otp}</div>
    <p style="margin:16px 0 8px">This code expires in ${ttlMinutes} minutes and can be used once.</p>
    <p style="color:#666;font-size:14px">
      <strong>Didn't request this?</strong> You can safely ignore this email —
      your password has not been changed and your account is still secure.
      Nobody can reset it without this code.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
    <p style="font-size:12px;color:#888">We'll never ask you for this code by phone, chat or email reply.</p>
    <p style="font-size:12px;color:#666">Thanks — The SoulSync Team</p>
  </div>
  `;
};

exports.otpTemplate = (otp, name) => {
  const displayName = name || '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.4;">
    <h2 style="color:#7b2cbf">SoulSync — One Time Password (OTP)</h2>
    <p>Hi ${displayName},</p>
    <p>Your verification code is:</p>
    <div style="font-size:22px;font-weight:700;margin:16px 0;padding:12px 16px;background:#f7f2fb;border-radius:6px;display:inline-block">${otp}</div>
    <p>This code will expire in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    <hr />
    <p style="font-size:12px;color:#666">Thanks — The SoulSync Team</p>
  </div>
  `;
};
