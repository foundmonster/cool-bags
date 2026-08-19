# Cool Bags - Netlify Deployment Guide

## Current Status

✅ **Site deployed to Netlify**
✅ **GitHub token configured**
✅ **Ready for feature development**

---

## Deployment Information

**Domain:** coolbags.info (configure in Netlify after deployment)
**Netlify URL:** (will be auto-generated, e.g. cool-bags-abc123.netlify.app)
**Deploy Status:** Check at https://app.netlify.com

---

## Environment Variables Set Up

### In Netlify Dashboard

Site configuration → Environment variables:

- ✅ `GITHUB_TOKEN` - For creating GitHub issues automatically (needs `repo` scope)
- ✅ `MAILGUN_API_KEY` - Brand-request confirmation emails, read by `netlify/functions/create-issue.js`
- ✅ `MAILGUN_DOMAIN` - The Mailgun sending domain. Required alongside the key; if it is missing the
  send silently fails against `https://api.mailgun.net/v3/undefined/messages`

### In GitHub Actions secrets

- ✅ `BUTTONDOWN_API_KEY` - Read only by `.github/workflows/notify-brand-added.yml`, to send the
  "your brand is live" email. It needs to exist as a **GitHub Actions secret**.
  Note: it is *also* set as a Netlify project variable (confirmed in the 2026-08-15 dev-server log),
  but no Netlify Function reads it, so that copy is unused. Harmless, but it is one more place a
  secret lives than necessary — consider removing it from Netlify.

See `.env.example` for the canonical list.

---

## Features (all shipped)

1. ✅ **Feedback Form Modal** - Anonymous issue submission
2. ✅ **Request Brand Button** - Specialized form for brand requests
3. ✅ **GitHub Issue Creation** - Automatic via Netlify Functions
4. ✅ **Email Notifications** - Mailgun for request confirmations, Buttondown for brand-live emails

---

## How Features Will Deploy

After each feature is built:

1. Code is committed to git
2. Push to GitHub
3. Netlify auto-detects changes
4. Deploys automatically (~30 seconds)
5. Feature is live!

---

## Testing Workflow

1. Submit form on live site
2. Check GitHub issues: https://github.com/foundmonster/cool-bags/issues
3. Verify issue created correctly
4. Check Netlify Functions logs if issues occur

---

## Useful Links

- **Netlify Dashboard:** https://app.netlify.com
- **GitHub Repo:** https://github.com/foundmonster/cool-bags
- **GitHub Issues:** https://github.com/foundmonster/cool-bags/issues
- **Netlify Functions Docs:** https://docs.netlify.com/functions/overview/

---

## Troubleshooting

### Function not working?
- Check Netlify Functions logs in dashboard
- Verify environment variables are set
- Check GitHub token has `repo` scope

### Changes not deploying?
- Check Netlify deploy log
- Ensure changes are pushed to GitHub main branch
- Trigger manual deploy if needed

---

Last updated: August 14, 2026 (restored from commit `782ff9d^` after being lost to `.gitignore`;
environment variables and feature status corrected against the code)
