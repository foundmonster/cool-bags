# Cool Bags Development Workflow

## Branch Strategy (Reduces Netlify Deployments by ~75%)

### 🌿 Development Branch (`dev`)
- **Primary working branch** for all daily changes
- Add new bags, update documentation, fix bugs
- **No production deployments** - saves credits
- Unlimited commits without cost concerns

### 🚀 Production Branch (`main`)
- **Production deployments only** via scheduled merges
- Merges from `dev` twice weekly (Tuesday & Friday)
- **Reduces deployments from ~36/month to 8/month**
- **Saves ~420 credits/month** (540 → 120 credits)

## Workflow Commands

### Daily Development (Use `dev` branch)
```bash
# Switch to dev branch (if not already)
git checkout dev

# Make changes, add new bags, etc.
# ... edit files ...

# Commit changes (commit freely - no deployment cost!)
git add .
git commit -m "Add 5 new Patagonia bags"
git push origin dev
```

### Documentation Changes (Skip Netlify)
For documentation-only changes that don't need immediate deployment:
```bash
git commit -m "[skip netlify] Update README with new brand instructions"
git push origin dev
```

### Emergency Hotfixes (Direct to main)
Only for critical fixes that can't wait for scheduled merge:
```bash
git checkout main
# ... make urgent fix ...
git commit -m "🚨 HOTFIX: Fix broken brand link"
git push origin main
# This will trigger immediate deployment (15 credits)
```

## Scheduled Deployments

### Automatic Schedule
- **Tuesday 10:00 AM UTC** (5:00 AM EST, 2:00 AM PST)
- **Friday 10:00 AM UTC** (5:00 AM EST, 2:00 AM PST)

### What Happens Automatically
1. **GitHub Actions checks** if `dev` has new commits
2. **Creates Pull Request** with summary of changes
3. **Auto-merges if no conflicts** (most cases)
4. **Netlify deploys** new version to production
5. **Email notifications sent** for any new brands

### Manual Merge (If Needed)
If conflicts occur, you'll get a PR comment notification:
1. Visit the PR on GitHub
2. Resolve conflicts via web interface or locally
3. Merge manually when ready

## Cost Impact

### Before (Unoptimized)
- 36 deployments/month × 15 credits = **540 credits**
- Cost: ~54% of monthly credit allowance

### After (Optimized)
- 8 scheduled deployments/month × 15 credits = **120 credits**
- Cost: ~12% of monthly credit allowance
- **Savings: 420 credits/month (~$4.20/month)**

## Skip Netlify Patterns

Use `[skip netlify]` in commit messages for changes that don't need deployment:

```bash
# Documentation updates
git commit -m "[skip netlify] Update brand submission guidelines"

# Work-in-progress commits
git commit -m "[skip netlify] WIP: Adding new bag data structure"

# README changes
git commit -m "[skip netlify] Fix typo in README"

# Configuration changes (if they don't affect site)
git commit -m "[skip netlify] Update .gitignore"
```

## Branch Protection & Rules

### Main Branch Protection (Set in GitHub)
- ✅ Require pull request reviews (optional - you decide)
- ✅ Restrict pushes to main (reduces accidental deployments)
- ✅ Delete head branches automatically (keeps repo clean)

### Netlify Branch Settings (Already Configured)
- ✅ Production deploys: `main` branch only
- ✅ Dev branch: builds for preview, no production deployment

## Usage Monitoring

Track your credit consumption in Netlify dashboard:
- **Target:** Stay under 1,000 credits/month
- **Current optimized estimate:** ~600 credits/month
  - 120 (deployments) + 387 (bandwidth) + 80 (requests) = ~587 credits
- **Monthly cost:** $9.00 (within plan limits)

---

## Quick Reference

| Action | Branch | Deploys? | Credits |
|--------|--------|----------|---------|
| Add new bags | `dev` | No | 0 |
| Documentation | `dev` + `[skip netlify]` | No | 0 |
| Scheduled merge | `dev` → `main` | Yes | 15 |
| Emergency fix | `main` | Yes | 15 |

**Remember:** Work on `dev`, deploy twice weekly, save money! 💰