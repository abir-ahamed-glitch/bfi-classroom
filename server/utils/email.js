import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

function getTransporter() {
  const user = (process.env.EMAIL_USER || 'bangladesh.film.institute@gmail.com').trim();
  const pass = (process.env.EMAIL_PASS || 'rexmeerkbwqbtzha').replace(/\s+/g, '');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    }
  });
}

export const sendPasswordResetEmail = async (toEmail, resetLink) => {
  try {
    const user = (process.env.EMAIL_USER || 'bangladesh.film.institute@gmail.com').trim();
    const transporter = getTransporter();
    const mailOptions = {
      from: `"BFI Classroom" <${user}>`,
      to: toEmail,
      subject: 'Password Reset Request - BFI Classroom',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.5;">You requested to reset your password for BFI Classroom.</p>
          <p style="color: #334155; font-size: 15px; line-height: 1.5;">Please click the button below to reset your password. This link is valid for 15 minutes.</p>
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

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent successfully to %s: %s', toEmail, info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending password reset email to %s:', toEmail, error);
    return false;
  }
};
