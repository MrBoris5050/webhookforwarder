# MongoDB on VPS — Create database for Webhook Forwarder

Use this when MongoDB is already installed on your VPS. Run the steps below **on the VPS** (or from a machine that can reach the VPS MongoDB port).

## 1. Connect to MongoDB on the VPS

SSH into your VPS, then open the MongoDB shell:

```bash
mongosh
```

If MongoDB has authentication enabled, connect as admin first:

```bash
mongosh "mongodb://admin:YOUR_ADMIN_PASSWORD@localhost:27017/admin"
```

## 2. Create the database and app user

In `mongosh`, run the following. Replace:

- `webhookforwarder` — database name (or set `MONGODB_DB_NAME` in .env to match)
- `webhookapp` — username for the app
- `CHOOSE_A_STRONG_PASSWORD` — password for that user

```javascript
// Use (create) the database
use webhookforwarder

// Create a user with read/write on this database only
db.createUser({
  user: "webhookapp",
  pwd: "CHOOSE_A_STRONG_PASSWORD",
  roles: [
    { role: "readWrite", db: "webhookforwarder" }
  ]
})
```

You should see: `{ ok: 1 }`. Exit with `exit`.

## 3. Allow remote connections (if app runs off the VPS)

If the Node app runs on **another machine** (e.g. your laptop or a different server):

1. In MongoDB config (e.g. `/etc/mongod.conf`), set `bindIp: 0.0.0.0` (or the app server’s IP) and restart MongoDB.
2. Open port `27017` in the VPS firewall for the app server’s IP only (recommended):

   ```bash
   # Example: allow only from app server IP 203.0.113.10
   sudo ufw allow from 203.0.113.10 to any port 27017
   sudo ufw reload
   ```

If the app runs **on the same VPS** as MongoDB, use `localhost` in the URI and skip this.

## 4. Set .env on the app server

On the machine where the webhook forwarder runs, set in `.env`:

**Same VPS as MongoDB (localhost):**

```env
MONGODB_URI=mongodb://webhookapp:CHOOSE_A_STRONG_PASSWORD@localhost:27017/webhookforwarder
# MONGODB_DB_NAME=webhookforwarder
```

**App on a different host (replace with your VPS IP or hostname):**

```env
MONGODB_URI=mongodb://webhookapp:CHOOSE_A_STRONG_PASSWORD@YOUR_VPS_IP:27017/webhookforwarder
# MONGODB_DB_NAME=webhookforwarder
```

Use the same password you used in `db.createUser`. Restart the app; it will create the collections (`webhooks`, `dlq`, `activity_logs`, `stats`) on first use.

## 5. Optional: one-liner for mongosh

If you prefer a single command on the VPS (replace the password):

```bash
mongosh --eval "
  use webhookforwarder;
  db.createUser({
    user: 'webhookapp',
    pwd: 'CHOOSE_A_STRONG_PASSWORD',
    roles: [{ role: 'readWrite', db: 'webhookforwarder' }]
  });
"
```

## Collections created by the app

The app creates these collections automatically when it starts and receives data:

| Collection       | Purpose                          |
|------------------|-----------------------------------|
| `webhooks`       | Stored webhook payloads (replay)  |
| `dlq`            | Dead-letter queue entries         |
| `activity_logs`  | Forward success/failure events    |
| `stats`          | Single-doc counters (received, etc.) |

No need to create them manually.

---

## Test connection directly on the VPS

To confirm MongoDB and the `webhookapp` user work **on the server itself** (avoids firewall/auth issues from your PC):

### Option A: Minimal test (only Node + mongodb on VPS)

On the VPS, in any folder:

```bash
npm init -y
npm install mongodb
```

Copy the script from the project `scripts/test-mongo-vps.js` into that folder, then run:

```bash
node test-mongo-vps.js "mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder"
```

Use the same user/password/db you created in mongosh. You should see: `✓ Database connection OK.`

### Option B: Run the project’s test script on the VPS

If the app is already deployed on the VPS:

1. `cd` into the project directory.
2. Ensure `.env` uses **localhost** (not the VPS public IP):
   ```env
   MONGODB_URI=mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder
   ```
3. Run:
   ```bash
   node scripts/test-db-connection.js
   ```

Using `localhost` on the VPS uses the local MongoDB and avoids remote auth. Once this works, the app can use the same URI when running on the VPS.
