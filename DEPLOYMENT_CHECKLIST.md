# 🚀 Deployment Checklist for Render

## ⚠️ CRITICAL: Environment Variables

### Required on Render Dashboard

Go to **Render Dashboard** → **Your Service** → **Environment** tab and ensure these are set:

#### Frontend URL (CRITICAL!)
```
Key: FRONTEND_URL
Value: https://ludo-252.onrender.com
```

**Why this matters:**
- ❌ Without this: Referral links will show `undefined` or `localhost`
- ✅ With this: Referral links work correctly with your domain

#### Other Required Variables
```
Key: VITE_SOCKET_URL
Value: https://ludo-252.onrender.com

Key: CONNECTION_URI
Value: mongodb+srv://ludo:ilyaas@ludo.1umgvpn.mongodb.net/ludo?retryWrites=true&w=majority&appName=ludo

Key: JWT_SECRET
Value: 8f9a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7

Key: NODE_ENV
Value: production

Key: VITE_API_URL
Value: /api

Key: VITE_USE_REAL_API
Value: true
```

---

## 📋 Deployment Steps

### 1. Set Environment Variables
- Go to Render Dashboard
- Navigate to Environment tab
- Add/verify all variables above
- **Most Important:** Set `FRONTEND_URL` to your actual domain

### 2. Deploy Code
Run these commands in your local terminal:

```cmd
cd "c:\Users\ILYAAS ABDIRAHMAN\Downloads\ludo-master (1)"
git add .
git commit -m "Deploy changes"
git push origin main
```

### 3. Clear Build Cache (if needed)
- Go to Render Dashboard
- Click "Manual Deploy"
- Select "Clear build cache & deploy"

### 4. Verify Deployment
After deployment completes:

#### Check Build Logs
Look for these confirmations:
```
✅ VITE_SOCKET_URL loaded
✅ Frontend build successful
✅ Backend started
```

#### Test in Browser
1. Go to your deployed site
2. Login to your account
3. Click "Referrals" button
4. Check that the share URL shows:
   - ✅ `https://ludo-252.onrender.com/signup?ref=SOM-LUDO-XXXXX`
   - ❌ NOT `http://localhost:3000/signup?ref=undefined`

---

## 🐛 Troubleshooting

### Issue: Referral link shows `localhost`
**Fix:** Set `FRONTEND_URL` environment variable on Render

### Issue: Referral code shows `undefined`
**Possible causes:**
1. User account created before referral system was implemented
2. Migration script not run
3. Database connection issue

**Fix:** Run migration script:
```cmd
cd backend
node migrations/add_referral_codes.js
```

### Issue: Signup button doesn't have subdomain
**Fix:** Ensure `FRONTEND_URL` is set correctly in Render environment variables

---

## ✅ Post-Deployment Checklist

- [ ] All environment variables set on Render
- [ ] Code pushed to GitHub
- [ ] Render deployment completed successfully
- [ ] Build logs show no errors
- [ ] Referral links show correct domain (not localhost)
- [ ] Referral codes are not `undefined`
- [ ] Signup links work correctly
- [ ] WhatsApp group link works
- [ ] Mobile UI displays correctly without scrolling

---

## 🔗 Quick Links

- **Render Dashboard:** https://dashboard.render.com/
- **Your MongoDB:** MongoDB Atlas Dashboard
- **GitHub Repo:** Your repository URL

---

## 📞 Support

If you encounter issues:
1. Check Render build logs for errors
2. Verify all environment variables are set
3. Check browser console for errors
4. Ensure backend is running (check Render logs)
