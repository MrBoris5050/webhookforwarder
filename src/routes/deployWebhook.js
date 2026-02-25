/**
 * Deploy webhook — POST /deploy-webhook
 * When DEPLOY_WEBHOOK_SECRET is set, a POST with header X-Deploy-Secret: <secret>
 * triggers the deploy script (git pull, npm install, pm2 restart) in the background.
 * Used by GitHub/GitLab webhooks to auto-deploy on push.
 */
const { spawn } = require('child_process');
const path = require('path');
const express = require('express');
const config = require('../config');
const { logger } = require('../middleware/logger');

const router = express.Router();

const DEPLOY_SCRIPT = path.join(process.cwd(), 'deploy', 'deploy.sh');

router.post('/', (req, res) => {
  const secret = config.deployWebhook?.secret;
  if (!secret) {
    return res.status(404).json({ error: 'Deploy webhook not configured' });
  }

  const provided = req.get('X-Deploy-Secret') || req.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (provided !== secret) {
    logger.warn('deploy_webhook_unauthorized', { path: '/deploy-webhook' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const child = spawn('bash', [DEPLOY_SCRIPT], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.unref();

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) {
        logger.error('deploy_script_exited', { code, stdout: stdout.slice(-500), stderr: stderr.slice(-500) });
      } else {
        logger.info('deploy_script_completed', { code });
      }
    });
    child.on('error', (err) => {
      logger.error('deploy_script_error', { error: err.message });
    });
  } catch (err) {
    logger.error('deploy_webhook_spawn_error', { error: err.message });
    return res.status(500).json({ error: 'Failed to start deploy' });
  }

  logger.info('deploy_webhook_triggered', { path: '/deploy-webhook' });
  res.status(202).json({ ok: true, message: 'Deploy started' });
});

module.exports = router;
