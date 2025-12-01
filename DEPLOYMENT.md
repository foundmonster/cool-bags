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

- ✅ `GITHUB_TOKEN` - For creating GitHub issues automatically
- ⏳ `BUTTONDOWN_API_KEY` - (Optional) Add when ready for email subscriptions

---

## Next Features to Build

Now that infrastructure is in place, we can add:

1. **Feedback Form Modal** - Anonymous issue submission
2. **Request Brand Button** - Specialized form for brand requests
3. **GitHub Issue Creation** - Automatic via Netlify Functions
4. **Email Subscriptions** - Optional Buttondown integration

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

Last updated: December 1, 2025
