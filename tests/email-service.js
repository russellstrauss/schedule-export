import nodemailer from 'nodemailer';

/**
 * Send email notification via SMTP
 * 
 * Why credentials are needed:
 * - SMTP servers require authentication to prevent spam
 * - Email providers (Gmail, Outlook, etc.) verify you're authorized to send emails
 * - Without credentials, anyone could send emails from your account (security risk)
 * 
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML body
 * @param {string} options.text - Email text body (optional)
 */
export async function sendEmail({ to, subject, html, text }) {
  // Get email configuration from environment variables
  const emailConfig = {
    // Gmail SMTP configuration (most common)
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || process.env.GMAIL_USER,
      pass: process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD
    }
  };

  // If no SMTP credentials, throw helpful error
  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    throw new Error(
      'Email credentials not configured. Set SMTP_USER and SMTP_PASSWORD (or GMAIL_USER and GMAIL_APP_PASSWORD) environment variables.\n' +
      'For Gmail, you need to create an App Password: https://support.google.com/accounts/answer/185833\n' +
      'Alternatively, you can skip email notifications by not setting these variables.'
    );
  }

  // Create transporter
  const transporter = nodemailer.createTransport(emailConfig);

  // Verify connection
  try {
    await transporter.verify();
  } catch (error) {
    throw new Error(`SMTP connection failed: ${error.message}`);
  }

  // Send email
  const mailOptions = {
    from: emailConfig.auth.user,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]*>/g, '') // Strip HTML tags for text version
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Format test failure email
 */
export function formatTestFailureEmail(testResults) {
  const subject = `❌ Cloud Function Tests Failed - ${new Date().toLocaleString()}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background-color: #dc3545; color: white; padding: 20px; }
        .content { padding: 20px; }
        .test-result { margin: 10px 0; padding: 10px; border-left: 4px solid #dc3545; background-color: #f8f9fa; }
        .test-name { font-weight: bold; color: #dc3545; }
        .error { color: #dc3545; font-family: monospace; }
        .summary { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Cloud Function Test Failure</h1>
        <p>Tests failed at ${new Date().toLocaleString()}</p>
      </div>
      <div class="content">
        <div class="summary">
          <h2>Test Summary</h2>
          <p><strong>Total Tests:</strong> ${testResults.total}</p>
          <p><strong>Passed:</strong> ${testResults.passed}</p>
          <p><strong>Failed:</strong> ${testResults.failed}</p>
          <p><strong>Duration:</strong> ${testResults.duration}ms</p>
        </div>
        
        <h2>Failed Tests</h2>
        ${testResults.failures.map(failure => `
          <div class="test-result">
            <div class="test-name">${failure.name}</div>
            <div class="error">${escapeHtml(failure.error)}</div>
          </div>
        `).join('')}
        
        <h2>Function Details</h2>
        <p><strong>Function URL:</strong> ${testResults.functionUrl}</p>
        <p><strong>Test Run Time:</strong> ${new Date(testResults.timestamp).toLocaleString()}</p>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

function escapeHtml(text) {
  if (typeof text !== 'string') text = String(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

