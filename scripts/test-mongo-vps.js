#!/usr/bin/env node
/**
 * Standalone MongoDB connection test — run this ON THE VPS (no full project needed).
 *
 * On the VPS:
 *   npm init -y
 *   npm install mongodb
 *   node test-mongo-vps.js "mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder"
 *
 * Or with env:
 *   MONGODB_URI="mongodb://webhookapp:webPass12@localhost:27017/webhookforwarder" node test-mongo-vps.js
 */
const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI || process.argv[2];

if (!uri) {
  console.error('Usage: node test-mongo-vps.js <MONGODB_URI>');
  console.error('   or: MONGODB_URI="mongodb://user:pass@localhost:27017/dbname" node test-mongo-vps.js');
  process.exit(1);
}

const safeUri = uri.replace(/:([^@]+)@/, ':****@');
console.log('Connecting to:', safeUri);

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await client.db().command({ ping: 1 });
    console.log('Ping result:', result);
    console.log('\n✓ Database connection OK.');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Connection failed:', err.message);
    if (err.message.includes('Authentication failed')) {
      console.error('  → Check username/password. Ensure the user was created in mongosh (see docs/mongodb-vps-setup.md).');
      console.error('  → Use localhost (not 127.0.0.1 or VPS IP) when testing on the same server.');
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
