// Netlify Function: Create GitHub Issue
// Called when user submits feedback or brand request

// Email template function
function generateBrandRequestEmail(brandName, issueUrl, issueNumber) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Brand Request Received - Cool Bags</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f7; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="500" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 4px; max-width: 500px;">
          <tr>
            <td style="padding: 32px 24px 24px; border-bottom: 1px solid rgba(0, 0, 0, 0.06);">
              <h1 style="margin: 0; font-size: 20px; font-weight: 400; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Cool Bags</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px; font-size: 13px; line-height: 1.6; color: #1d1d1f;">
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Hi there,</p>
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Thanks for requesting <strong style="font-weight: 500;">${brandName}</strong> to be added to Cool Bags!</p>
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">We've created an issue to track this request:</p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0; width: 100%;">
                <tr>
                  <td style="background: #f5f5f7; border-radius: 4px; padding: 16px;">
                    <a href="${issueUrl}" style="color: #0071e3; text-decoration: none; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">View Request on GitHub →</a>
                    <div style="font-size: 11px; color: #86868b; margin-top: 4px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Issue #${issueNumber}</div>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">We're manually curating the catalog, so it may take a few weeks to add new brands. We'll send you an email when <strong style="font-weight: 500;">${brandName}</strong> goes live!</p>
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">✌️</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px; border-top: 1px solid rgba(0, 0, 0, 0.06); font-size: 11px; color: #86868b; line-height: 1.5;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Cool Bags • <a href="https://coolbags.info" style="color: #86868b; text-decoration: none; padding: 4px 8px; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 4px; display: inline-block;">Visit Site</a></p>
              <p style="margin: 8px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;"><a href="{{unsubscribe_url}}" style="color: #86868b; text-decoration: none; padding: 4px 8px; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 4px; display: inline-block;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
    if (email) {
      issueBody += `- Email: ${email}\n`;
    }
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

    // Send confirmation email for brand requests
    if (type === 'request' && email && process.env.BUTTONDOWN_API_KEY) {
      try {
        // Extract brand name from title (remove "[Brand Request] " prefix)
        const brandName = title.replace('[Brand Request] ', '');

        // First, subscribe the user to the newsletter
        const subscribeResponse = await fetch('https://api.buttondown.email/v1/subscribers', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            tags: ['brand-request'],
            metadata: {
              issue_number: issue.number,
              issue_url: issue.html_url,
              brand_requested: brandName,
              submitted_at: new Date().toISOString()
            }
          })
        });

        // Continue even if subscription fails (might already be subscribed)
        if (!subscribeResponse.ok) {
          const subError = await subscribeResponse.text();
          console.log('Subscription response:', subError);
          // Don't throw - they might already be subscribed
        }

        // Generate email HTML
        const emailHTML = generateBrandRequestEmail(brandName, issue.html_url, issue.number);

        // Send email via Buttondown API
        const emailResponse = await fetch('https://api.buttondown.email/v1/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subject: `We received your request for ${brandName}`,
            body: emailHTML,
            email_type: 'private',
            to: email
          })
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.text();
          console.error('Buttondown email send failed:', errorData);
          // Don't fail the whole request if email fails
        } else {
          console.log('Confirmation email sent successfully');
        }
      } catch (emailError) {
        console.error('Email sending error:', emailError);
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
