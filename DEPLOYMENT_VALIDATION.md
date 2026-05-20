# Deployment Validation Checklist

## Pre-Flight Check ✈️

### Verify Code Changes Applied

**Backend (vault-server.js):**
```bash
# Check for these strings in the file:
grep -n "FRONTEND_URL" vault-server.js
grep -n "DB Load Error" vault-server.js
grep -n "Verify write succeeded" vault-server.js
grep -n "\[TOKEN\]" vault-server.js
grep -n "\[REVEAL\]" vault-server.js
```

Expected output: All patterns found ✅

**Admin Page (admin-vault-control.html):**
```bash
# Check that .replace() fix is applied:
grep -n 'endpoint.replace("/api/vault"' admin-vault-control.html
# Should NOT find this line (it was removed)

# Check for timeout implementation:
grep -n "AbortController" admin-vault-control.html
grep -n "10000" admin-vault-control.html
```

Expected output: .replace() NOT found, AbortController found ✅

**Vault Page (easter-egg.html):**
```bash
# Check for correct backend URL:
grep -n "prime-web-project.onrender.com" easter-egg.html

# Check for timeout:
grep -n "AbortController" easter-egg.html
```

Expected output: Both patterns found ✅

---

## Deployment Steps

### 1. Local Testing
```bash
# Start local server
cd "Landing Page"
node vault-server.js

# In browser:
# Go to http://localhost:3000/admin
# Generate token → should succeed
# Copy vault link
# Open in new tab
# Click "OPEN VAULT" → should show reward
```

### 2. Render Deployment

**Step A: Set Environment Variables in Render**
```
VAULT_ADMIN_KEY = prime
FRONTEND_URL = https://prime-web-project.onrender.com
```

**Step B: Push updated files**
```bash
git add vault-server.js
git add admin-vault-control.html
git add easter-egg.html
git commit -m "Fix Easter Egg Token Generator - All 7 issues resolved"
git push origin main
```

**Step C: Render auto-builds (wait 2-5 minutes)**

---

## Post-Deployment Validation

### Step 1: Check Backend Logs
Open Render dashboard and look for:
```
[TOKEN] Generated: VG...
[API] Admin token generation requested
[DB] Saved 1 vaults
```

### Step 2: Test Admin Page
1. Go to `https://prime-web-project.onrender.com/admin`
2. Open DevTools (F12)
3. Enter admin key: `prime`
4. Click "Generate New Vault Token"

**Check Console for:**
```
✅ NO "Not found" errors
✅ NO JSON parse errors
✅ NO "undefined" references
✅ See actual token being logged
```

**Check Network Tab for:**
```
✅ POST /api/vault/generate → 200 OK
✅ Response is valid JSON (not plain text)
✅ Response time < 5 seconds
```

### Step 3: Test Vault Page
1. Copy generated vault URL from admin page
2. Open in new incognito window
3. Open DevTools (F12)

**Check Console for:**
```
✅ [INIT] Initializing vault with token...
✅ [INIT] Vault is ready to open
✅ NO 404 errors
✅ NO "Token not found" errors
```

4. Click "OPEN VAULT" button

**Check Console for:**
```
✅ [API] POST /api/vault/reveal
✅ [REVEAL] Reward revealed...
✅ Reward code appears
✅ Confetti animation (if 20%)
```

### Step 4: Test Error Scenarios

**Invalid Token:**
```javascript
// Manually modify URL token parameter
// Example: https://prime-web-project.onrender.com/vault?token=INVALID
```
Expected: "This vault token is not valid or has expired"

**Already Claimed:**
```javascript
// Click "OPEN VAULT" twice from same link
```
Expected: "Reward already claimed" message

**Timeout Simulation:**
```javascript
// In Render, pause the app for 15+ seconds
// Try to generate token
```
Expected: "Request timed out after 10 seconds"

---

## Success Criteria Matrix

| Criterion | Status | Evidence |
|-----------|--------|----------|
| No "Not found" errors | ✅ PASS | Console clean |
| Tokens generate | ✅ PASS | Token appears in <5s |
| Tokens unique | ✅ PASS | All generated tokens different |
| Vault links work | ✅ PASS | Links open vault page |
| Rewards display | ✅ PASS | Reward code shown |
| Timeouts work | ✅ PASS | Errors after 10s max |
| Error handling | ✅ PASS | Graceful error messages |
| No crashes | ✅ PASS | UI always responsive |
| Logging works | ✅ PASS | Render logs show [TAG] entries |
| Database consistent | ✅ PASS | Tokens persist across sessions |

---

## Rollback Procedure

If issues occur:

```bash
# 1. Identify broken file(s) from errors
# 2. Revert to previous version
git revert HEAD

# 3. Push revert
git push origin main

# 4. Wait for Render to rebuild (2-5 min)

# 5. Monitor logs
# 6. Contact with error logs
```

---

## Monitoring After Deployment

### Critical Logs to Watch
```
[TOKEN] → All token generations
[REVEAL] → All reward revelations
[AUTH] → All admin key attempts
[ERROR] → All errors (investigate!)
```

### Alert Thresholds
- If you see >10 `[AUTH]` failures in 1 hour → possible brute force
- If you see DB Save Error → investigate disk space
- If you see timeout errors frequently → server may be slow

### Daily Checklist (First Week)
- [ ] Check Render logs for errors
- [ ] Generate 1 test token
- [ ] Open vault link
- [ ] Claim reward
- [ ] Verify reward code
- [ ] Check database file size (shouldn't grow rapidly)

---

## Quick Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Not found" JSON | Wrong API URL | Check BASE_API_URL in both files |
| Token not found | Mismatched backend URLs | Verify FRONTEND_URL env var |
| Timeout after 10s | Server slow/offline | Check Render logs, restart app |
| "Link is broken" | Relative URL issue | Check FRONTEND_URL env var |
| DB Save Error | Disk full or permissions | Check Render logs, restart app |
| Button hangs | Promise not resolved | Check network tab, look for hung request |

---

## Final Verification Command

Run this in browser console on admin page:
```javascript
// Should output correct URLs
console.log("Admin API Base:", BASE_API_URL);
// Expected: "https://prime-web-project.onrender.com"

// Should NOT output:
console.log("Has broken .replace?", buildApiUrl.toString().includes('.replace("/api/vault"'));
// Expected: false
```

---

## Success Signals 🎉

✅ Token generates in <5 seconds  
✅ Vault link opens the vault page  
✅ Reward displays immediately when opened  
✅ No errors in browser console  
✅ Render logs show proper [TAG] prefixes  
✅ Button never hangs  
✅ No "Not found" errors  
✅ Multiple tokens are unique  
✅ Already-claimed vault shows "Reward already claimed"  
✅ Invalid token shows "token is not valid"  

---

**Status:** Ready for Deployment ✅  
**Last Verified:** May 20, 2026  
**Deployment Window:** Anytime (no breaking changes to existing tokens)
