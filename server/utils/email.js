import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export const sendPasswordResetEmail = async (toEmail, resetLink) => {
  try {
    const mailOptions = {
      from: `"BFI Classroom" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password for BFI Classroom.</p>
          <p>Please click the button below to reset your password. This link will expire in 15 minutes.</p>
          <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
          <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        </div>
      `,
      text: `Password Reset Request\n\nYou requested to reset your password for BFI Classroom.\n\nPlease copy and paste the following link into your browser to reset your password. This link will expire in 15 minutes:\n${resetLink}\n\nIf you did not request this, please ignore this email and your password will remain unchanged.`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
};
