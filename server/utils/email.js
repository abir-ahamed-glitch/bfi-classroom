import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Configure Nodemailer transport strictly from environment variables.
 * Returns null if SMTP credentials are not configured.
 * Hard-coded fallbacks have been permanently removed.
 */
export function getTransporter() {
  if (process.env.IS_STAGING_SERVER === 'true' || process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true') {
    return null;
  }
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.replace(/\s+/g, '');

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    }
  });
}

/**
 * Mail option builder for Password Reset (supporting both self-service and Super Admin-initiated)
 */
export function buildPasswordResetMailOptions(toEmail, resetLink, { isSuperAdminInitiated = false } = {}) {
  const user = process.env.EMAIL_USER?.trim() || 'no-reply@bfibd.org';

  if (isSuperAdminInitiated) {
    return {
      from: `"BFI Classroom" <${user}>`,
      to: toEmail,
      subject: 'Administrative Password Reset - BFI Classroom',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin-top: 0;">Administrative Password Reset</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.5;">An administrator password reset has been initiated by Super Admin for your BFI Classroom account.</p>
          <p style="color: #334155; font-size: 15px; line-height: 1.5;">All existing active sessions have been terminated. Please click the button below to set your new password. This single-use link is valid for <strong>30 minutes</strong>.</p>
          <div style="margin: 25px 0;">
            <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">Set New Password</a>
          </div>
          <p style="color: #64748b; font-size: 13px; line-height: 1.4;">If you did not expect this reset, please contact your Super Administrator immediately.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #94a3b8; font-size: 12px;">Bangladesh Film Institute (BFI) • Digital Classroom Hub</p>
        </div>
      `,
      text: `Administrative Password Reset - BFI Classroom\n\nAn administrator password reset has been initiated by Super Admin for your BFI Classroom account.\n\nAll existing active sessions have been terminated. Please open the link below to set your new password. This link will expire in 30 minutes:\n${resetLink}\n\nIf you did not expect this, please contact your Super Administrator immediately.\n\nBangladesh Film Institute (BFI)`
    };
  }

  // Standard user / self-service recovery
  return {
    from: `"BFI Classroom" <${user}>`,
    to: toEmail,
    subject: 'Password Reset Request - BFI Classroom',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">You requested to reset your password for BFI Classroom.</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">Please click the button below to reset your password. This link is valid for <strong>15 minutes</strong>.</p>
        <div style="margin: 25px 0;">
          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">Reset Password</a>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.4;">If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">Bangladesh Film Institute (BFI) • Digital Classroom Hub</p>
      </div>
    `,
    text: `Password Reset Request - BFI Classroom\n\nYou requested to reset your password for BFI Classroom.\n\nPlease copy and paste the following link into your browser to reset your password. This link will expire in 15 minutes:\n${resetLink}\n\nIf you did not request this, please ignore this email and your password will remain unchanged.\n\nBangladesh Film Institute (BFI)`
  };
}

/**
 * Mail option builder for Password Change Security Notification
 */
export function buildPasswordChangeNotificationMailOptions(toEmail, { dhakaTime, ipAddress }) {
  const user = process.env.EMAIL_USER?.trim() || 'no-reply@bfibd.org';
  return {
    from: `"BFI Classroom Security" <${user}>`,
    to: toEmail,
    subject: 'Security Alert: Your BFI Classroom Password Has Been Changed',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Security Alert: Password Changed</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">Your BFI Classroom account password was successfully updated.</p>
        <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
          <p style="margin: 4px 0; color: #475569; font-size: 14px;"><strong>Time (Dhaka):</strong> ${dhakaTime}</p>
          <p style="margin: 4px 0; color: #475569; font-size: 14px;"><strong>IP Address:</strong> ${ipAddress || 'Unknown'}</p>
        </div>
        <p style="color: #dc2626; font-size: 14px; line-height: 1.4;">If you did not authorize this change, please notify your Super Administrator immediately to lock your account.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">Bangladesh Film Institute (BFI) • Security Governance</p>
      </div>
    `,
    text: `Security Alert: Your BFI Classroom Password Has Been Changed\n\nYour account password was updated on ${dhakaTime} from IP ${ipAddress}.\n\nIf you did not authorize this change, please notify your Super Administrator immediately.\n\nBangladesh Film Institute (BFI)`
  };
}

/**
 * Mail option builder for Email Ownership Verification Challenge
 */
export function buildEmailVerificationMailOptions(toEmail, verificationLink) {
  const user = process.env.EMAIL_USER?.trim() || 'no-reply@bfibd.org';
  return {
    from: `"BFI Classroom" <${user}>`,
    to: toEmail,
    subject: 'Verify Your Email Address - BFI Classroom',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Verify Your Email Address</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">Please confirm that this email address belongs to your BFI Classroom administrator profile.</p>
        <div style="margin: 25px 0;">
          <a href="${verificationLink}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">Verify Email</a>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.4;">This verification link will expire in 24 hours.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">Bangladesh Film Institute (BFI) • Digital Classroom Hub</p>
      </div>
    `,
    text: `Verify Your Email Address - BFI Classroom\n\nPlease confirm that this email address belongs to your BFI Classroom administrator profile by visiting:\n${verificationLink}\n\nThis verification link will expire in 24 hours.\n\nBangladesh Film Institute (BFI)`
  };
}

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (toEmail, resetLink, options = {}) => {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      console.warn('SMTP transporter unconfigured; email dispatch skipped.');
      return false;
    }
    const mailOptions = buildPasswordResetMailOptions(toEmail, resetLink, options);
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email dispatched to %s: %s', toEmail, info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending password reset email to %s:', toEmail, error.message);
    return false;
  }
};

/**
 * Send password change security notification
 */
export const sendPasswordChangeNotificationEmail = async (toEmail, details) => {
  try {
    const transporter = getTransporter();
    if (!transporter) return false;
    const mailOptions = buildPasswordChangeNotificationMailOptions(toEmail, details);
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending password change notification to %s:', toEmail, error.message);
    return false;
  }
};

/**
 * Send email verification challenge
 */
export const sendEmailVerificationChallenge = async (toEmail, verificationLink) => {
  try {
    const transporter = getTransporter();
    if (!transporter) return false;
    const mailOptions = buildEmailVerificationMailOptions(toEmail, verificationLink);
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending verification email to %s:', toEmail, error.message);
    return false;
  }
};
