#!/usr/bin/env node
/**
 * Test MongoDB connection using MONGODB_URI from .env
 * Run from project root: node scripts/test-db-connection.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/store/db');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('No MONGODB_URI set in .env — running in-memory (no DB connection).');
    process.exit(0);
  }

  // Mask password in log
  const safeUri = uri.replace(/:([^@]+)@/, ':****@');
  console.log('Connecting to MongoDB:', safeUri);

  try {
    await db.init();
    const result = await db.ping();
    console.log('DB ping result:', result);
    console.log('\n✓ Database connection OK.');
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Database connection failed:', err.message);
    if (err.message.includes('auth')) {
      console.error('  Check username/password and that the user exists (see docs/mongodb-vps-setup.md).');
    }
    if (err.code === 'ECONNREFUSED') {
      console.error('  MongoDB may not be running or is not reachable on the given host/port.');
    }
    process.exit(1);
  }
}

main();
