# Deploy Webhook Forwarder on VPS (app.bundlesharer.net)

Deploy the app on the same VPS as MongoDB and expose it at **https://app.bundlesharer.net** using Nginx and PM2.

---

## 1. Prerequisites on the VPS

- Node.js 18+ (e.g. `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`)
- Nginx: `sudo apt install -y nginx`
- PM2: `sudo npm install -g pm2`
- MongoDB already running with `webhookapp` user (see docs/mongodb-vps-setup.md)

---

## 2. Deploy the app

```bash
cd /var/www
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
git clone <YOUR_REPO_URL> webhookforwarder
# Or upload via scp/rsync

cd /var/www/webhookforwarder
npm install --production
```

---

## 3. Environment on the VPS

Create `.env` in the project root:

```bash
nano /var/www/webhookforwarder/.env
```

Use at least:

```env
PORT=3004
NODE_ENV=production
MONGODB_URI=mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder
TARGET_URLS=''
ADMIN_PASSWORD=your-secure-admin-password
ADMIN_AUTH_REQUIRED=true
LOG_LEVEL=info
REQUEST_TIMEOUT_MS=10000
RETRY_CONFIG={"maxAttempts":3,"delays":[1000,3000,9000]}
MAX_STORED_WEBHOOKS=2000
MAX_DLQ_ENTRIES=500
```

Optional — for auto-deploy on git push (see section 9):

```env
DEPLOY_WEBHOOK_SECRET=your-random-secret-for-deploy-webhook
```

Save and exit. Ensure no one else can read it: `chmod 600 .env`.

---

## 4. Run with PM2

```bash
cd /var/www/webhookforwarder
pm2 start src/index.js --name webhook-forwarder
pm2 save
pm2 startup
```

Check: `pm2 status` and `pm2 logs webhook-forwarder`. App should be listening on port 3004.

---

## 5. DNS — A record for the subdomain

The **root domain** (bundlesharer.net) points elsewhere; only **app.bundlesharer.net** should point to this VPS. Add an **A record** for the subdomain with your VPS IP:

| Type | Name / Host | Value / Target | TTL (optional) |
|------|--------------|----------------|----------------|
| **A** | `app` | `31.97.154.198` | 300 or default |

- **Name:** `app` (so the hostname is app.bundlesharer.net). Some panels use `app.bundlesharer.net` as the name.
- **Value:** Your VPS public IP (replace `31.97.154.198` with the real IP).

This is a separate A record from the root domain’s A record; the root can keep pointing to another server.

Then **Nginx** for app.bundlesharer.net:

```bash
sudo cp /var/www/webhookforwarder/deploy/nginx-app.bundlesharer.net.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx-app.bundlesharer.net.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

After DNS propagates, open http://app.bundlesharer.net — you should see the app.

---

## 6. HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.bundlesharer.net
```

Follow the prompts. Certbot will add SSL. Test: https://app.bundlesharer.net

---

## 7. Useful commands

| Action       | Command |
|-------------|--------|
| **Deploy / update (one command)** | `npm run deploy` or `./deploy/deploy.sh` |
| Logs        | `pm2 logs webhook-forwarder` |
| Restart     | `pm2 restart webhook-forwarder` |
| Status      | `pm2 status` |
| Reload Nginx| `sudo systemctl reload nginx` |

**Deploy script** (run from project root on VPS): pulls latest (if git), runs `npm install --production`, restarts the app with PM2, and saves the process list. Ensure `deploy/deploy.sh` is executable: `chmod +x deploy/deploy.sh`.

---

## 8. Pull and update the project

When you change code and push to your Git host, update the app on the VPS in one of two ways.

### Option A — Manual update (one command on VPS)

SSH into the VPS, then from the project root:

```bash
cd /var/www/webhookforwarder
chmod +x deploy/deploy.sh   # only needed once
npm run deploy
```

Or run the script directly: `./deploy/deploy.sh`. This will:

1. **Pull** latest from the default branch (if the directory is a git repo)
2. **Install** dependencies: `npm install --production`
3. **Restart** the app: `pm2 restart webhook-forwarder` and `pm2 save`

### Option B — Auto-deploy via webhook (push → VPS deploys)

Configure your Git host so that each push triggers the app’s deploy webhook; the VPS will then pull and restart automatically (see section 9).

---

## 9. Auto-deploy webhook (push → VPS deploys)

When `DEPLOY_WEBHOOK_SECRET` is set in `.env`, the app exposes:

- **URL:** `POST https://app.bundlesharer.net/deploy-webhook`
- **Auth:** header `X-Deploy-Secret: <your-secret>` (or `Authorization: Bearer <your-secret>`)

A valid request runs `deploy/deploy.sh` in the background (git pull, npm install, pm2 restart) and returns `202 Accepted`. Nginx already proxies to the app, so no extra Nginx config is needed.

### 9.1 One-time setup on the VPS

1. Add to `.env` (use a long random string, e.g. `openssl rand -hex 24`):

   ```env
   DEPLOY_WEBHOOK_SECRET=your-random-secret-here
   ```

2. Restart the app: `pm2 restart webhook-forwarder`.

3. Make the deploy script executable (once): `chmod +x deploy/deploy.sh`.

### 9.2 GitHub — trigger deploy on push

GitHub’s repo webhooks send a signature in `X-Hub-Signature-256`, not a custom header. The easiest way to auto-deploy is a **GitHub Action** that runs on push and calls your deploy endpoint with `X-Deploy-Secret`.

1. In your repo, create `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy to VPS
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - name: Trigger deploy on VPS
           run: |
             curl -sS -X POST "https://app.bundlesharer.net/deploy-webhook" \
               -H "X-Deploy-Secret: ${{ secrets.DEPLOY_WEBHOOK_SECRET }}"
   ```

2. In GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Name: `DEPLOY_WEBHOOK_SECRET`, value: the same string as in your VPS `.env` (`DEPLOY_WEBHOOK_SECRET`).

3. Push to `main`; the workflow will POST to the VPS and the app will run the deploy script.

### 9.3 GitLab — trigger deploy on push

1. **Settings** → **Webhooks**. URL: `https://app.bundlesharer.net/deploy-webhook`. If your GitLab supports **Custom headers**, add `X-Deploy-Secret` with your secret.

2. Or use a **CI pipeline**: add a job that runs on push and curls the deploy endpoint. In `.gitlab-ci.yml`:

   ```yaml
   deploy:
     stage: deploy
     script:
       - 'curl -sS -X POST "https://app.bundlesharer.net/deploy-webhook" -H "X-Deploy-Secret: $DEPLOY_WEBHOOK_SECRET"'
     only:
       - main
   ```

   In GitLab: **Settings** → **CI/CD** → **Variables** → add `DEPLOY_WEBHOOK_SECRET` (masked).

---

**Webhook URL:** `https://app.bundlesharer.net/webhook`  
**Admin dashboard:** `https://app.bundlesharer.net/admin/stats/html`
