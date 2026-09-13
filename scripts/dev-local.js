/**
 * Local dev: start an isolated MongoDB (not the main webhookforwarder DB), then the app.
 * Usage: npm run dev:local
 */
const { spawn } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');

const LOCAL_DB = 'webhookforwarder_local';
const LOCAL_URI = `mongodb://127.0.0.1:27017/${LOCAL_DB}`;

async function main() {
  console.log('[dev-local] Starting isolated MongoDB on 27017 /', LOCAL_DB);
  const mongod = await MongoMemoryServer.create({
    instance: { port: 27017, dbName: LOCAL_DB },
  });
  console.log('[dev-local] Mongo ready:', mongod.getUri());

  const child = spawn('npx', ['nodemon', 'src/index.js'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      MONGODB_URI: LOCAL_URI,
      MONGODB_DB_NAME: LOCAL_DB,
    },
  });

  const shutdown = async () => {
    child.kill();
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  child.on('exit', async (code) => {
    await mongod.stop();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[dev-local] failed:', err.message);
  process.exit(1);
});
