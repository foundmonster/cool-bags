// Brand Added Notification Email Template
// Use this when a brand request is completed

function generateBrandAddedEmail(brandName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${brandName} is now on Cool Bags!</title>
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
              <p style="font-size: 17px; margin: 0 0 16px 0; font-weight: 400; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Great news!</p>

              <p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;"><strong style="font-weight: 500;">${brandName}</strong> is now on Cool Bags. Thanks for the suggestion!</p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0; width: 100%;">
                <tr>
                  <td align="center">
                    <a href="https://coolbags.info" style="display: inline-block; padding: 12px 24px; font-size: 13px; font-weight: 400; color: #ffffff; background: #1d1d1f; text-decoration: none; border-radius: 4px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">
                      Browse ${brandName} Bags →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;">Want another brand added? <a href="https://coolbags.info/brands.html" style="color: #0071e3; text-decoration: none;">Submit another request</a> anytime.</p>

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

module.exports = { generateBrandAddedEmail };
