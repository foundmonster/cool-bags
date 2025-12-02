# Buttondown Email Setup for Cool Bags

## Overview
Setting up automated email notifications for Cool Bags using Buttondown with custom email design matching the website aesthetic.

## Current Buttondown Setup (Personal)
- **Existing account**: Uses custom HTML/CSS templates
- **Custom code template**: Django template with `{% load fqd %} {% load md %} {% load i18n %}`
- **Custom CSS**: aktiv-grotesk font, minimal bordered-link style
- **Account email**: (need to confirm - likely cory.malnarick@gmail.com)

---

## Email Types Needed for Cool Bags

### 1. Brand Request Confirmation
**Trigger**: User submits brand request via modal
**Purpose**: Confirm receipt and set expectations
**Subject**: "We received your request for [Brand Name]"
**Content**:
- Thank you message
- Link to GitHub issue to track progress
- Estimated timeline (if applicable)
- Unsubscribe option

### 2. Brand Added Notification
**Trigger**: Brand request issue labeled "completed" or "added"
**Purpose**: Notify requester their brand is now live
**Subject**: "[Brand Name] is now on Cool Bags!"
**Content**:
- Celebration message
- Direct link to browse the new brand
- Invitation to request another brand
- Unsubscribe option

### 3. Issue Update Notification
**Trigger**: Feedback/bug issue status changes
**Purpose**: Keep users informed on their submissions
**Subject**: "Update on your Cool Bags feedback"
**Content**:
- Issue status update
- Link to GitHub issue
- Next steps (if applicable)
- Unsubscribe option

### 4. General Notifications (Optional - "Sign Up for Notifications" button)
**Trigger**: User signs up for general updates
**Purpose**: Announce new features, major brand additions
**Frequency**: Weekly or bi-weekly digest
**Content**:
- New brands added this week
- Site improvements
- Call to action (browse, submit feedback)

---

## Buttondown Setup Steps

### Step 1: Create Cool Bags Newsletter
1. Log into existing Buttondown account
2. Create new newsletter: "Cool Bags Updates"
3. Set newsletter settings:
   - Name: Cool Bags
   - Description: "Updates on new bag brands and site features"
   - From email: (use existing verified email)
   - Reply-to: cory.malnarick@gmail.com

### Step 2: Get API Key
1. Go to Buttondown Settings → API
2. Copy API key
3. Add to Netlify environment variables:
   ```
   BUTTONDOWN_API_KEY=your_key_here
   ```

### Step 3: Design Email Templates

#### Email Design Requirements (Match Cool Bags Website)
**Typography**:
- Font family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif
- Body text: 13px
- Headings: 18-20px, font-weight 400
- Labels: 12px uppercase, letter-spacing 0.5px, color #86868b

**Colors**:
- Primary text: #1d1d1f
- Secondary text: #86868b
- Background: #f5f5f7 (light) or #ffffff (white)
- Links: #0071e3 (Apple blue)
- Borders: rgba(0, 0, 0, 0.1)

**Link Style** (different from personal newsletter):
- Border: 1px solid rgba(0, 0, 0, 0.1)
- Border-radius: 4px
- Padding: 8px 16px
- Background: white
- Transition: all 0.2s
- Hover: background rgba(0, 0, 0, 0.02)

**Layout**:
- Max-width: 500px (match modal width)
- Clean, minimal spacing
- No decorative elements
- Consistent with website aesthetic

#### Template Differences from Personal Newsletter

| Personal Newsletter | Cool Bags Newsletter |
|---------------------|---------------------|
| aktiv-grotesk font | SF Pro Display/Text |
| Bordered pill-style links | Clean button-style links |
| Dotted HR dividers | Solid 1px borders |
| Numbered circle bullets | Standard bullets or none |
| Max-width 32rem | Max-width 500px |
| Opacity 0.5 footer | Standard footer |

### Step 4: Custom HTML Template for Cool Bags

**Base structure** (modify existing template):
```html
{% load fqdn %} {% load md %} {% load i18n %}

<html lang="{{ newsletter.locale }}" xml:lang="{{ newsletter.locale }}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <style type="text/css">
    /* Cool Bags specific CSS here */
  </style>
  <meta name="x-apple-disable-message-reformatting">
  {% if not disable_dark_mode %}
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  {% endif %}
</head>
<body>
  <div class="newsletter-container">
    <div class="newsletter-header">
      <!-- Cool Bags logo/header -->
    </div>

    <div class="newsletter-body">
      {{ rendered_body|md:newsletter|safe }}
    </div>

    <div class="newsletter-footer">
      <!-- Footer content -->
    </div>

    <div class="newsletter-colophon">
      <p class="colophon-text">
        Cool Bags • <a href="https://coolbags.info">Visit Site</a><br>
        <br>
        This email brought to you by <a href="https://buttondown.email">Buttondown</a>.<br>
        <br>
        <a href="{{ unsubscribe_url }}">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
```

**Custom CSS** (replace aktiv-grotesk styles):
```css
body, div, p, h1, h2, h3, h4, h5, h6, ol, ul, table, tr, td {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;
  color: #1d1d1f;
}

.newsletter-container {
  max-width: 500px;
  margin: 0 auto;
  background: #ffffff;
  padding: 24px;
}

.newsletter-header {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.header-text {
  font-size: 20px;
  font-weight: 400;
  color: #1d1d1f;
}

.newsletter-body {
  margin-bottom: 32px;
  font-size: 13px;
  line-height: 1.6;
}

.newsletter-body p {
  margin-bottom: 16px;
}

.newsletter-body h2 {
  font-size: 18px;
  font-weight: 400;
  margin-top: 24px;
  margin-bottom: 12px;
}

a {
  color: #0071e3;
  text-decoration: none;
  border: 1px solid rgba(0, 113, 227, 0.2);
  border-radius: 4px;
  padding: 8px 16px;
  display: inline-block;
  transition: all 0.2s;
}

a:hover {
  background: rgba(0, 113, 227, 0.05);
}

.newsletter-colophon {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.colophon-text {
  font-size: 11px;
  color: #86868b;
  line-height: 1.5;
}

.colophon-text a {
  font-size: 11px;
  padding: 4px 8px;
  color: #86868b;
  border-color: rgba(0, 0, 0, 0.1);
}
```

### Step 5: Integration with Netlify Functions

**Modify `/netlify/functions/create-issue.js`** to add Buttondown subscription:

```javascript
// After successfully creating GitHub issue
if (email && type === 'request') {
  // Subscribe to Buttondown for brand request updates
  await fetch('https://api.buttondown.email/v1/subscribers', {
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
        brand_name: title.replace('[Brand Request] ', ''),
        requested_at: new Date().toISOString()
      }
    })
  });
}
```

### Step 6: GitHub Actions for Email Notifications

Create `.github/workflows/notify-issue-update.yml`:

```yaml
name: Notify on Issue Update

on:
  issues:
    types: [closed, labeled]

jobs:
  send-email:
    runs-on: ubuntu-latest
    steps:
      - name: Check if issue has email
        id: check_email
        run: |
          # Parse email from issue body
          # Extract issue number
          # Check if label is "completed" or "added"

      - name: Send Buttondown email
        if: steps.check_email.outputs.has_email == 'true'
        run: |
          # Call Buttondown API to send transactional email
```

---

## Email Content Templates

### Brand Request Confirmation Email

**Subject**: We received your request for [Brand Name]

**Body**:
```
Hi there,

Thanks for requesting [Brand Name] to be added to Cool Bags!

We've created issue #[ISSUE_NUMBER] to track this request. You can follow along here:
[ISSUE_LINK]

We're manually curating the catalog, so it may take a few weeks to add new brands. We'll send you an email when [Brand Name] goes live!

✌️
Cool Bags

---
[Unsubscribe]
```

### Brand Added Notification Email

**Subject**: [Brand Name] is now on Cool Bags!

**Body**:
```
Great news!

[Brand Name] is now on Cool Bags. Thanks for the suggestion!

[Browse [Brand Name] →]

Want another brand added? Submit another request anytime.

✌️
Cool Bags

---
[Unsubscribe]
```

---

## Next Steps

1. ✅ Design email templates in HTML with Cool Bags styling
2. ⏳ Create "Cool Bags" newsletter in Buttondown
3. ⏳ Get API key and add to Netlify
4. ⏳ Update Netlify function to subscribe users
5. ⏳ Set up GitHub Actions for issue update emails
6. ⏳ Test end-to-end flow

---

## Notes

- Email design should feel like an extension of the website
- Keep emails minimal and focused
- Use same button/link styling as modals
- Maintain consistent spacing and typography
- Consider A/B testing subject lines for better open rates
