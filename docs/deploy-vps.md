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
PORT=3000
NODE_ENV=production
MONGODB_URI=mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder
TARGET_URLS=https://your-target.example.com/webhook
ADMIN_PASSWORD=your-secure-admin-password
ADMIN_AUTH_REQUIRED=true
LOG_LEVEL=info
REQUEST_TIMEOUT_MS=10000
RETRY_CONFIG={"maxAttempts":3,"delays":[1000,3000,9000]}
MAX_STORED_WEBHOOKS=2000
MAX_DLQ_ENTRIES=500
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

Check: `pm2 status` and `pm2 logs webhook-forwarder`. App should be listening on port 3000.

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
| Logs        | `pm2 logs webhook-forwarder` |
| Restart     | `pm2 restart webhook-forwarder` |
| Status      | `pm2 status` |
| Reload Nginx| `sudo systemctl reload nginx` |

---

**Webhook URL:** `https://app.bundlesharer.net/webhook`  
**Admin dashboard:** `https://app.bundlesharer.net/admin/stats/html`
