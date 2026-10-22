const nodemailer = require("nodemailer");

let cachedTransporter = null;
let isEthereal = false;

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    // Real SMTP configuration (Hostinger, Gmail, SendGrid, etc.)
    const port = Number(process.env.SMTP_PORT || 587);
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
    isEthereal = false;
    return cachedTransporter;
  }

  // Fallback for local testing when real SMTP password is not configured yet
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    isEthereal = true;
    console.log("[mailer] Real SMTP credentials not provided. Using Ethereal test account:", testAccount.user);
    return cachedTransporter;
  } catch (err) {
    console.warn("[mailer] Could not create test account, fallback to direct console:", err.message);
    return null;
  }
}

async function sendWelcomeEmail({ email, name = "Member" }) {
  if (!email) throw new Error("Recipient email is required");

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "info@crestuseccommerce.store";
  const customerName = name || "Valued Member";

  const mailOptions = {
    from: `"CRESTUS" <${fromEmail}>`,
    to: email,
    subject: "Welcome to Crestus — Where Luxury Meets Everyday Wear ✨",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Crestus</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0A0A0A; color: #FFFFFF; padding: 40px 15px; margin: 0;">
        <div style="max-width: 580px; margin: 0 auto; background-color: #121214; border-radius: 20px; border: 1px solid #27272a; padding: 40px 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          
          <!-- Brand Header -->
          <div style="margin-bottom: 24px;">
            <h1 style="color: #FFFFFF; font-size: 34px; font-weight: 700; letter-spacing: -1.5px; margin: 0;">
              CRESTUS<span style="color: #F41CB2;">.</span>
            </h1>
            <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 3px; color: #71717a; margin-top: 6px;">Everyday Luxury Fashion</p>
          </div>

          <!-- Divider -->
          <div style="width: 40px; height: 2px; background-color: #F41CB2; margin: 0 auto 30px auto;"></div>

          <!-- Main Greeting -->
          <h2 style="font-size: 22px; font-weight: 600; color: #FFFFFF; margin: 0 0 16px 0; letter-spacing: -0.5px;">
            Welcome to Crestus, ${customerName}!
          </h2>
          <p style="font-size: 14px; color: #a1a1aa; line-height: 1.7; margin: 0 0 28px 0;">
            Thank you for creating an account with Crestus. You now have exclusive access to limited-edition drops, private preview sales, and direct order tracking.
          </p>

          <!-- Member Benefits -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid #27272a; border-radius: 16px; padding: 22px; margin-bottom: 32px; text-align: left;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #e4e4e7; font-weight: 600; letter-spacing: 0.5px;">Your Member Privileges:</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #a1a1aa; line-height: 1.8;">
              <li>50% offer automatically applied to every piece in the catalogue</li>
              <li>Priority access to limited drops and everyday essentials</li>
              <li>Live order tracking and seamless doorstep fulfillment</li>
            </ul>
          </div>

          <!-- CTA Button -->
          <div style="margin-bottom: 35px;">
            <a href="https://crestuseccommerce.store/shop" target="_blank" style="background-color: #F41CB2; color: #FFFFFF; padding: 14px 36px; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; display: inline-block; box-shadow: 0 10px 20px rgba(244, 28, 178, 0.25);">
              Explore Collection &rarr;
            </a>
          </div>

          <!-- Footer Note -->
          <hr style="border: none; border-top: 1px solid #27272a; margin: 30px 0 20px 0;" />
          <p style="font-size: 11px; color: #52525b; line-height: 1.6; margin: 0;">
            This email was sent to ${email} because an account was registered on Crestus.<br>
            © 2026 Crestus Ecommerce Private Limited. All rights reserved.
          </p>
        </div>
      </body>
      </html>
    `,
  };

  const transporter = await getTransporter();
  if (!transporter) {
    console.log(`[mailer] Mock send welcome email to ${email}`);
    return { success: true, mocked: true };
  }

  const info = await transporter.sendMail(mailOptions);
  let previewUrl = null;
  if (isEthereal) {
    previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[mailer] Welcome email sent! Preview URL: ${previewUrl}`);
  }

  return {
    success: true,
    messageId: info.messageId,
    previewUrl,
  };
}

module.exports = { sendWelcomeEmail };
