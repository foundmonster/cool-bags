# Cool Bags - Netlify Setup Steps

## Completed ✅

- [x] Created Netlify account
- [x] Connected GitHub repository to Netlify
- [x] Initial deployment triggered

## In Progress 🔄

- [ ] Configure custom domain (coolbags.info)
- [ ] Create GitHub Personal Access Token
- [ ] Add environment variables to Netlify

---

## Step-by-Step: Configure Custom Domain

### Option 1: Using Netlify DNS (Recommended - Easiest)

**In Netlify Dashboard:**

1. Go to your site → **"Domain management"** (or "Domains" in left sidebar)
2. Click **"Add a domain"**
3. Enter: `coolbags.info`
4. Netlify will show: "This domain is registered but not configured"
5. Click **"Add domain"**
6. Netlify will ask: **"Do you want to use Netlify DNS?"**
   - Click **"Yes, use Netlify DNS"**

**Netlify will give you 4 nameservers like:**
```
dns1.p01.nsone.net
dns2.p01.nsone.net
dns3.p01.nsone.net
dns4.p01.nsone.net
```

**Then go to your domain registrar** (where you bought coolbags.info):

7. Log into your domain registrar (GoDaddy, Namecheap, Google Domains, etc.)
8. Find **"DNS Settings"** or **"Nameservers"**
9. Change from default nameservers to Netlify's 4 nameservers (paste them in)
10. Save changes

**Wait 5 minutes to 24 hours** for DNS to propagate (usually ~30 minutes).

---

### Option 2: Using External DNS (More Complex)

If you want to keep your current DNS provider:

**In Netlify Dashboard:**

1. Go to **"Domain management"** → **"Add a domain"**
2. Enter: `coolbags.info`
3. Click **"Verify"**
4. Netlify will say: "Configure DNS records at your provider"

**Netlify will show you these records:**

```
A Record:
Name: @
Value: 75.2.60.5 (Netlify's IP)

CNAME Record:
Name: www
Value: [your-site-name].netlify.app
```

**Go to your domain registrar's DNS settings:**

5. Add **A Record**:
   - Host/Name: `@` (or leave blank)
   - Points to: `75.2.60.5`
   - TTL: 3600 (or default)

6. Add **CNAME Record**:
   - Host/Name: `www`
   - Points to: `[your-netlify-url].netlify.app`
   - TTL: 3600 (or default)

7. Save DNS records

**Wait 5 minutes to 24 hours** for DNS propagation.

---

## Common Domain Setup Issues

### Issue 1: "Domain already taken" or "Domain claimed by another team"

**Solution:**
- The domain might be added to another Netlify account
- Remove it from the other account first
- Or contact Netlify support to transfer ownership

---

### Issue 2: "Cannot verify domain"

**Solution:**
- Make sure you own the domain
- Check domain is not expired
- Try Option 1 (Netlify DNS) instead of Option 2

---

### Issue 3: DNS not propagating

**Check DNS status:**
- Go to: https://dnschecker.org
- Enter: `coolbags.info`
- See if changes are propagating globally

**Speed it up:**
- Clear your browser cache
- Try incognito/private mode
- Try different browser
- Wait longer (DNS can take 24 hours, but usually 30 min - 2 hours)

---

### Issue 4: HTTPS/SSL certificate issues

**Netlify auto-provisions SSL certificates**, but:
- Wait for DNS to fully propagate first
- Then go to Netlify → Domain settings → HTTPS
- Click "Verify DNS configuration"
- SSL cert will provision in ~10 minutes

---

## Where Did You Register coolbags.info?

**Common registrars and where to find DNS settings:**

### GoDaddy
1. Log in → My Products
2. Click "DNS" next to your domain
3. Change nameservers or add A/CNAME records

### Namecheap
1. Log in → Domain List
2. Click "Manage" next to coolbags.info
3. Change nameservers or Advanced DNS for records

### Google Domains
1. Log in → My Domains
2. Click coolbags.info
3. DNS tab → Custom name servers or Custom records

### Cloudflare
1. Log in → Select coolbags.info
2. DNS tab → Add records
3. (Note: If using Cloudflare, disable proxy/orange cloud for initial setup)

---

## What's Blocking You?

**Tell me:**
1. Where did you register coolbags.info? (GoDaddy, Namecheap, etc.)
2. What error message are you seeing in Netlify?
3. Did you try Option 1 (Netlify DNS) or Option 2 (External DNS)?

I can give you exact instructions for your specific registrar!

---

## Next Steps After Domain Works

Once `coolbags.info` is live:

### Step 2: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: `cool-bags-netlify`
4. Expiration: No expiration
5. Scope: ☑️ `repo` (full control)
6. Generate and COPY token

### Step 3: Add Token to Netlify

1. Netlify dashboard → Site configuration → Environment variables
2. Add variable:
   - Key: `GITHUB_TOKEN`
   - Value: [paste token]
3. Save

### Step 4: Ready to Build Features

Once environment variables are set, I can build:
- Feedback modal
- Brand request button
- GitHub issue creation
- All features deploy automatically!

---

## Current Status

- ✅ Netlify account created
- ✅ GitHub repo connected
- ✅ Site deployed (at [something].netlify.app)
- ⏳ Custom domain pending (coolbags.info)
- ⏳ GitHub token pending
- ⏳ Environment variables pending

---

Last updated: December 1, 2025
