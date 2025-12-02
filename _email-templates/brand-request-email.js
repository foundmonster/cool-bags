// Brand Request Confirmation Email Template
// Use this when someone submits a brand request

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

        <!-- Email Container -->
        <table width="500" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 4px; max-width: 500px;">

          <!-- Header -->
          <tr>
            <td style="padding: 32px 24px 24px; border-bottom: 1px solid rgba(0, 0, 0, 0.06);">
              <h1 style="margin: 0; font-size: 20px; font-weight: 400; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Cool Bags</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 24px; font-size: 13px; line-height: 1.6; color: #1d1d1f;">
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Hi there,</p>

              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Thanks for requesting <strong style="font-weight: 500;">${brandName}</strong> to be added to Cool Bags!</p>

              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">We've created an issue to track this request:</p>

              <!-- Issue Link Box -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0; width: 100%;">
                <tr>
                  <td style="background: #f5f5f7; border-radius: 4px; padding: 16px;">
                    <a href="${issueUrl}" style="color: #0071e3; text-decoration: none; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">
                      View Request on GitHub →
                    </a>
                    <div style="font-size: 11px; color: #86868b; margin-top: 4px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Issue #${issueNumber}</div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">We're manually curating the catalog, so it may take a few weeks to add new brands. We'll send you an email when <strong style="font-weight: 500;">${brandName}</strong> goes live!</p>

              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">✌️</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px; border-top: 1px solid rgba(0, 0, 0, 0.06); font-size: 11px; color: #86868b; line-height: 1.5;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">
                Cool Bags • <a href="https://coolbags.info" style="color: #86868b; text-decoration: none; padding: 4px 8px; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 4px; display: inline-block;">Visit Site</a>
              </p>
              <p style="margin: 8px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">
                <a href="{{unsubscribe_url}}" style="color: #86868b; text-decoration: none; padding: 4px 8px; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 4px; display: inline-block;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { generateBrandRequestEmail };
