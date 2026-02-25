/**
 * MongoDB-backed persistence for webhooks, dead-letter queue, and activity logs.
 * Used when MONGODB_URI is set. All methods are async.
 */
const { MongoClient } = require('mongodb');
const config = require('../config');

const DB_NAME = process.env.MONGODB_DB_NAME || 'webhookforwarder';
let client = null;
let db = null;

function isEnabled() {
  return Boolean(config.store.mongodbUri);
}

function getDb() {
  if (!db) throw new Error('Database not initialized; call db.init() first');
  return db;
}

async function init() {
  if (!config.store.mongodbUri) return;
  client = new MongoClient(config.store.mongodbUri);
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes();
}

async function ensureIndexes() {
  const database = getDb();
  await database.collection('webhooks').createIndex({ saved_at: 1 });
  await database.collection('dlq').createIndex({ failed_at: -1 });
  await database.collection('activity_logs').createIndex({ created_at: -1 });
  await database.collection('activity_logs').createIndex({ target_id: 1 });
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

// ─── Webhooks ───────────────────────────────────────────────────

async function saveWebhook(requestId, data) {
  const database = getDb();
  const savedAt = new Date();
  const max = config.store.maxWebhooks;
  const doc = {
    _id: requestId,
    body: data.body,
    headers: normalizeHeaders(data.headers),
    received_at: data.receivedAt || null,
    method: data.method || 'POST',
    query: data.query || null,
    saved_at: savedAt,
  };
  await database.collection('webhooks').replaceOne({ _id: requestId }, doc, { upsert: true });

  const count = await database.collection('webhooks').countDocuments();
  if (count > max) {
    const oldest = await database.collection('webhooks')
      .find({}, { projection: { _id: 1 }, sort: { saved_at: 1 } })
      .limit(count - max)
      .toArray();
    if (oldest.length > 0) {
      await database.collection('webhooks').deleteMany({
        _id: { $in: oldest.map(d => d._id) },
      });
    }
  }
}

async function getWebhook(requestId) {
  const doc = await getDb().collection('webhooks').findOne({ _id: requestId });
  if (!doc) return null;
  return {
    requestId: doc._id,
    body: doc.body,
    headers: doc.headers || {},
    receivedAt: doc.received_at,
    method: doc.method,
    query: doc.query,
    savedAt: doc.saved_at instanceof Date ? doc.saved_at.toISOString() : doc.saved_at,
  };
}

async function listWebhooks(limit = 50, offset = 0) {
  const docs = await getDb().collection('webhooks')
    .find({})
    .sort({ saved_at: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();
  return docs.map(doc => ({
    requestId: doc._id,
    body: doc.body,
    headers: doc.headers || {},
    receivedAt: doc.received_at,
    method: doc.method,
    query: doc.query,
    savedAt: doc.saved_at instanceof Date ? doc.saved_at.toISOString() : doc.saved_at,
  }));
}

async function countWebhooks() {
  return getDb().collection('webhooks').countDocuments();
}

async function clearWebhooks() {
  await getDb().collection('webhooks').deleteMany({});
}

// ─── Dead-letter queue ───────────────────────────────────────────

async function pushDlq(entry) {
  const database = getDb();
  const id = `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const failedAt = new Date();
  const max = config.store.maxDLQ;
  await database.collection('dlq').insertOne({
    _id: id,
    request_id: entry.requestId,
    target_id: entry.targetId,
    target_url: entry.targetUrl || null,
    payload: entry.payload,
    headers: normalizeHeaders(entry.headers),
    error: entry.error || null,
    attempts: entry.attempts ?? null,
    received_at: entry.receivedAt || null,
    failed_at: failedAt,
  });

  const count = await database.collection('dlq').countDocuments();
  if (count > max) {
    const oldest = await database.collection('dlq')
      .find({}, { projection: { _id: 1 }, sort: { failed_at: 1 } })
      .limit(count - max)
      .toArray();
    if (oldest.length > 0) {
      await database.collection('dlq').deleteMany({
        _id: { $in: oldest.map(d => d._id) },
      });
    }
  }
  return id;
}

async function listDlq(limit = 50, offset = 0) {
  const docs = await getDb().collection('dlq')
    .find({})
    .sort({ failed_at: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();
  return docs.map(doc => ({
    id: doc._id,
    requestId: doc.request_id,
    targetId: doc.target_id,
    targetUrl: doc.target_url,
    payload: doc.payload,
    headers: doc.headers || {},
    error: doc.error,
    attempts: doc.attempts,
    receivedAt: doc.received_at,
    failedAt: doc.failed_at instanceof Date ? doc.failed_at.toISOString() : doc.failed_at,
  }));
}

async function getDlq(id) {
  const doc = await getDb().collection('dlq').findOne({ _id: id });
  if (!doc) return null;
  return {
    id: doc._id,
    requestId: doc.request_id,
    targetId: doc.target_id,
    targetUrl: doc.target_url,
    payload: doc.payload,
    headers: doc.headers || {},
    error: doc.error,
    attempts: doc.attempts,
    receivedAt: doc.received_at,
    failedAt: doc.failed_at instanceof Date ? doc.failed_at.toISOString() : doc.failed_at,
  };
}

async function removeDlq(id) {
  const result = await getDb().collection('dlq').deleteOne({ _id: id });
  return result.deletedCount > 0;
}

async function countDlq() {
  return getDb().collection('dlq').countDocuments();
}

async function clearDlq() {
  await getDb().collection('dlq').deleteMany({});
}

// ─── Activity logs & stats ────────────────────────────────────────

async function insertActivity(entry) {
  await getDb().collection('activity_logs').insertOne({
    request_id: entry.requestId,
    target_id: entry.targetId,
    status: entry.status,
    error: entry.error ?? null,
    status_code: entry.statusCode ?? null,
    duration_ms: entry.durationMs ?? null,
    created_at: entry.timestamp || new Date().toISOString(),
  });
}

async function incrementReceived() {
  const database = getDb();
  const stats = await database.collection('stats').findOne({ _id: 'singleton' });
  if (!stats) {
    await database.collection('stats').insertOne({
      _id: 'singleton',
      total_received: 1,
      start_time: new Date(),
    });
  } else {
    await database.collection('stats').updateOne(
      { _id: 'singleton' },
      { $inc: { total_received: 1 } }
    );
  }
}

async function getStatsSummary() {
  const database = getDb();
  const statsRow = await database.collection('stats').findOne({ _id: 'singleton' });
  const startTime = statsRow?.start_time ? new Date(statsRow.start_time) : new Date();
  const totalReceived = statsRow?.total_received ?? 0;
  const uptimeSec = Math.floor((Date.now() - startTime.getTime()) / 1000);

  const agg = await database.collection('activity_logs').aggregate([
    {
      $group: {
        _id: '$target_id',
        success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failure: { $sum: { $cond: [{ $eq: ['$status', 'failure'] }, 1, 0] } },
        last_success: { $max: { $cond: [{ $eq: ['$status', 'success'] }, '$created_at', null] } },
        last_failure: { $max: { $cond: [{ $eq: ['$status', 'failure'] }, '$created_at', null] } },
        total_attempts: { $sum: 1 },
        total_response_ms: { $sum: { $ifNull: ['$duration_ms', 0] } },
      },
    },
  ]).toArray();

  const targets = agg.map(row => {
    const totalAttempts = row.total_attempts || 0;
    const totalResponseMs = row.total_response_ms || 0;
    return {
      id: row._id,
      success: row.success || 0,
      failure: row.failure || 0,
      lastSuccess: row.last_success || null,
      lastFailure: row.last_failure || null,
      totalAttempts,
      avgResponseMs: totalAttempts > 0 ? Math.round(totalResponseMs / totalAttempts) : 0,
    };
  });

  const recentActivity = await database.collection('activity_logs')
    .find({})
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();
  const recentActivityMapped = recentActivity.map(doc => ({
    requestId: doc.request_id,
    targetId: doc.target_id,
    status: doc.status,
    error: doc.error,
    statusCode: doc.status_code,
    durationMs: doc.duration_ms,
    timestamp: doc.created_at,
  }));

  const recentFailures = await database.collection('activity_logs')
    .find({ status: 'failure' })
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();
  const recentFailuresMapped = recentFailures.map(doc => ({
    requestId: doc.request_id,
    targetId: doc.target_id,
    status: doc.status,
    error: doc.error,
    statusCode: doc.status_code,
    durationMs: doc.duration_ms,
    timestamp: doc.created_at,
  }));

  return {
    uptime: `${uptimeSec}s`,
    startTime: startTime.toISOString(),
    totalReceived,
    targets,
    recentFailures: recentFailuresMapped,
    recentActivity: recentActivityMapped,
  };
}

async function resetStats() {
  const database = getDb();
  await database.collection('stats').updateOne(
    { _id: 'singleton' },
    { $set: { total_received: 0, start_time: new Date() } },
    { upsert: true }
  );
  await database.collection('activity_logs').deleteMany({});
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/** Ping the database to verify connection (for health checks and connection tests). */
async function ping() {
  if (!config.store.mongodbUri) {
    return { ok: true, message: 'No database configured (in-memory mode)' };
  }
  const database = getDb();
  const result = await database.command({ ping: 1 });
  return result;
}

// ─── Targets (persisted in DB when DB enabled) ───────────────────

async function getTargets() {
  if (!config.store.mongodbUri) return null;
  const database = getDb();
  const doc = await database.collection('settings').findOne({ _id: 'targets' });
  return doc && Array.isArray(doc.value) ? doc.value : null;
}

async function saveTargets(targets) {
  const database = getDb();
  await database.collection('settings').replaceOne(
    { _id: 'targets' },
    { _id: 'targets', value: targets, updated_at: new Date() },
    { upsert: true }
  );
}

module.exports = {
  isEnabled,
  init,
  close,
  ping,
  getDb,
  getTargets,
  saveTargets,
  saveWebhook,
  getWebhook,
  listWebhooks,
  countWebhooks,
  pushDlq,
  listDlq,
  getDlq,
  removeDlq,
  countDlq,
  clearWebhooks,
  clearDlq,
  insertActivity,
  incrementReceived,
  getStatsSummary,
  resetStats,
};
