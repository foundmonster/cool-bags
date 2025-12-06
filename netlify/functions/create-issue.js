// Netlify Function: Create GitHub Issue
// Called when user submits feedback or brand request

const fetch = require('node-fetch');

// Email template function - Clean HTML with easy styling
function generateBrandRequestEmail(brandName, issueUrl, issueNumber) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brand Request Received</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background-color: #f8f9fa; color: #212529;">
  <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden;">

    <!-- Header -->
    <div style="background-color: #007bff; color: #ffffff; padding: 32px 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Cool Bags</h1>
      <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">Brand Request Received</p>
    </div>

    <!-- Content -->
    <div style="padding: 32px 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #212529;">Thanks for your request!</h2>

      <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.5; color: #495057;">
        We've received your request to add <strong style="color: #007bff;">${brandName}</strong> to our catalog.
      </p>

      <div style="background-color: #f8f9fa; border-left: 4px solid #007bff; padding: 16px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #212529;">GitHub Issue Created</p>
        <p style="margin: 0; font-size: 14px; color: #6c757d;">
          <a href="${issueUrl}" style="color: #007bff; text-decoration: none;">Issue #${issueNumber}</a> - Click to track progress
        </p>
      </div>

      <p style="margin: 20px 0 0 0; font-size: 16px; line-height: 1.5; color: #495057;">
        We manually curate each brand, so it may take a few weeks to review and add ${brandName}.
        We'll email you when it goes live!
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color: #f8f9fa; padding: 20px 24px; text-align: center; border-top: 1px solid #dee2e6;">
      <p style="margin: 0 0 8px 0; font-size: 14px; color: #6c757d;">
        <strong>Cool Bags</strong> - The Complete Bag Database
      </p>
      <p style="margin: 0; font-size: 14px;">
        <a href="https://coolbags.info" style="color: #007bff; text-decoration: none; margin-right: 16px;">Visit Site</a>
        <span style="color: #dee2e6;">|</span>
        <a href="mailto:hey@coolbags.info" style="color: #007bff; text-decoration: none; margin-left: 16px;">Contact Us</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse form data
    const data = JSON.parse(event.body);
    const { type, title, description, email, label, browser, url } = data;

    // Build issue body with all info
    let issueBody = `${description}\n\n---\n\n`;

    // Add metadata
    issueBody += `**Submission Details:**\n`;
    issueBody += `- Type: ${type}\n`;
    issueBody += `- Email provided: ${email ? 'yes' : 'no'}\n`;
    if (browser) {
      issueBody += `- Browser: ${browser}\n`;
    }
    if (url) {
      issueBody += `- Page: ${url}\n`;
    }
    issueBody += `- Submitted: ${new Date().toISOString()}\n`;

    // Create GitHub issue via API
    const response = await fetch('https://api.github.com/repos/foundmonster/cool-bags/issues', {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        title: title,
        body: issueBody,
        labels: [label || 'request']
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GitHub API Error:', errorData);
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const issue = await response.json();

// Send confirmation email for brand requests using Mailgun
    if (type === 'request' && email && process.env.MAILGUN_API_KEY) {
      try {
        // Extract brand name from title (remove "[Brand Request] " prefix)
        const brandName = title.replace('[Brand Request] ', '');

        // Simple plain text email
        const emailText = `Hi there!

Thanks for requesting ${brandName} to be added to Cool Bags!

We've created an issue to track this request:
${issue.html_url}
(Issue #${issue.number})

We're manually curating the catalog, so it may take a few weeks to add new brands. We'll send you an email when ${brandName} goes live!

Best regards,
Cool Bags Team

---
Cool Bags - The Complete Bag Database
Visit: https://coolbags.info`;

        // Mailgun API request
        const mailgunResponse = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            from: `Cool Bags Team <noreply@${process.env.MAILGUN_DOMAIN}>`,
            to: email,
            subject: `We received your request for ${brandName}`,
            text: emailText,
            'h:Reply-To': 'hey@coolbags.info'
          })
        });

        if (mailgunResponse.ok) {
          const result = await mailgunResponse.json();
          console.log('Confirmation email sent successfully via Mailgun:', result.id);
        } else {
          const errorText = await mailgunResponse.text();
          console.error('Mailgun API error:', mailgunResponse.status, errorText);
        }

      } catch (emailError) {
        console.error('Mailgun email sending error:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    // Return success with issue details
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        issueUrl: issue.html_url,
        issueNumber: issue.number,
        message: 'Feedback submitted successfully!'
      })
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Failed to submit feedback. Please try again or contact us directly.'
      })
    };
  }
};
