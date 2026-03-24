# ========================================
# DEPLOYMENT GUIDE
# ========================================

This app CANNOT be deployed to Vercel because it requires system dependencies (yt-dlp and ffmpeg) that serverless platforms don't support.

## Supported Deployment Platforms

### ✅ Option 1: Railway (Easiest - Recommended)

**Why Railway:**
- Supports system dependencies (yt-dlp, ffmpeg)
- GitHub integration
- Simple configuration
- Free tier available

**Steps:**
1. Sign up at https://railway.app
2. Click "New Project" → "Deploy from GitHub"
3. Select your `Loom-Extraction-App` repository
4. Railway will auto-detect Next.js and use `nixpacks.toml`
5. Add environment variables:
   - Go to project → Variables
   - Add: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, etc.
6. Deploy! Railway will build and run your app

**Files used:**
- `nixpacks.toml` - Tells Railway to install ffmpeg and yt-dlp

---

### ✅ Option 2: DigitalOcean/VPS (Full Control)

**Providers:**
- DigitalOcean ($6/month)
- Linode ($5/month)
- Vultr ($3.50/month)
- AWS EC2

**Steps:**
```bash
# 1. Create Ubuntu 22.04 droplet/instance

# 2. SSH into server
ssh root@your-server-ip

# 3. Install dependencies
sudo apt update
sudo apt install -y nodejs npm ffmpeg curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# 4. Clone repo
git clone https://github.com/TranThienPhong/Loom-Extraction-App.git
cd Loom-Extraction-App

# 5. Install and build
npm install
npm run build

# 6. Set environment variables
nano .env.local
# Add your API keys:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENROUTER_API_KEY=sk-or-...

# 7. Install PM2 (process manager)
sudo npm install -g pm2

# 8. Start app
pm2 start npm --name "loom-app" -- start
pm2 save
pm2 startup  # Follow instructions to enable auto-start

# 9. Setup Nginx (optional - for custom domain)
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/loom-app
```

**Nginx config example:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

### ✅ Option 3: Render.com (Free Tier Available)

**Why Render:**
- Supports Docker (includes system dependencies)
- Free tier with limitations
- GitHub integration

**Steps:**
1. Sign up at https://render.com
2. Click "New +" → "Web Service"
3. Connect GitHub repository
4. Configure:
   - **Environment:** Docker
   - **Build Command:** (auto from Dockerfile)
   - **Start Command:** (auto from Dockerfile)
5. Add environment variables in dashboard
6. Deploy!

**Files used:**
- `Dockerfile` - Contains all system dependencies

---

### ✅ Option 4: Docker (Any Platform)

Use Docker to deploy anywhere that supports containers:

```bash
# Build image
docker build -t loom-extraction-app .

# Run locally
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e OPENROUTER_API_KEY=sk-or-... \
  loom-extraction-app

# Or use docker-compose
docker-compose up -d
```

**Platforms supporting Docker:**
- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Fly.io
- Railway
- Render

---

## ❌ Platforms That DON'T Work

### Vercel
- ❌ Serverless (no system dependencies)
- ❌ Cannot install yt-dlp or ffmpeg
- **Error:** "yt-dlp is not installed"

### Netlify
- ❌ Static hosting and serverless functions only
- ❌ Cannot install system binaries

### AWS Lambda (direct)
- ❌ Requires custom Lambda layers for ffmpeg
- ⚠️ Too complex for this use case

---

## Quick Comparison

| Platform | Cost | Difficulty | System Deps | Best For |
|----------|------|------------|-------------|----------|
| **Railway** | $5/mo | ⭐ Easy | ✅ Yes | Quick deploy |
| **Render** | Free tier | ⭐⭐ Medium | ✅ Yes | Free hosting |
| **DigitalOcean** | $6/mo | ⭐⭐⭐ Advanced | ✅ Yes | Full control |
| **Docker** | Varies | ⭐⭐ Medium | ✅ Yes | Flexibility |
| Vercel | Free | N/A | ❌ No | ❌ Won't work |

---

## Recommended: Railway Deployment

**Railway is the easiest option** because:
1. ✅ `nixpacks.toml` is already configured
2. ✅ One-click GitHub integration
3. ✅ Automatic builds and deployments
4. ✅ Built-in environment variable management
5. ✅ Free $5 credit per month

**Steps:**
1. Push your latest code to GitHub (including `nixpacks.toml`)
2. Go to https://railway.app
3. Sign up with GitHub
4. Click "New Project" → "Deploy from GitHub repo"
5. Select `Loom-Extraction-App`
6. Add environment variables (click project → Variables tab)
7. Railway deploys automatically!

Your app will be live at: `your-app-name.up.railway.app`

---

## Environment Variables Needed

Make sure to set these in your deployment platform:

```bash
# Required (choose at least one AI provider)
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENROUTER_API_KEY=sk-or-v1-...

# Optional
OPENAI_API_KEY=sk-proj-...
APIFY_API_KEY=apify_api_...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1
```

---

## Troubleshooting

### "yt-dlp is not installed"
- ❌ You're on Vercel/Netlify/serverless platform
- ✅ Switch to Railway, Render, or VPS

### "ffmpeg is not installed"
- ❌ Same issue - wrong platform
- ✅ Deploy to platform with system dependencies

### Build fails on Railway
- Check that `nixpacks.toml` is in repo root
- Ensure all environment variables are set
- Check build logs in Railway dashboard

### App crashes after deployment
- Check logs: `pm2 logs` (VPS) or platform dashboard
- Verify API keys are correct
- Ensure yt-dlp and ffmpeg are in PATH

### Out of memory errors
- Increase VPS RAM (min 1GB recommended)
- Or upgrade Railway/Render plan

---

## Need Help?

1. Check deployment platform docs:
   - Railway: https://docs.railway.app
   - Render: https://render.com/docs
   - DigitalOcean: https://docs.digitalocean.com

2. Check app logs for specific errors

3. Verify system dependencies are installed:
```bash
yt-dlp --version
ffmpeg -version
node --version
```

---

**Ready to deploy? Start with Railway - it's the fastest way to get your app live!** 🚀
