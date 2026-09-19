const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 9090;

const MONGO_URI = 'mongodb://analytics_usr:b074b543cd0659deb7d4c911a865bb7d@localhost:16016/analytics?authSource=analytics';
const DB_NAME = 'analytics';
let db;

async function connectMongo() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('MongoDB 连接成功');
    db = client.db(DB_NAME);

    await db.collection('events').createIndex({ sessionId: 1 });
    await db.collection('events').createIndex({ userId: 1 });
    await db.collection('events').createIndex({ eventTime: -1 });
    await db.collection('events').createIndex({ eventType: 1 });
    // 每日去重：同一 IP 同一天对同一目标只记一条原始事件
    await db.collection('events').createIndex(
      { dedupKey: 1 },
      { unique: true, sparse: true }
    );
    console.log('索引创建成功');
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    process.exit(1);
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 去重键：事件类型 + 目标(链接/元素/页面) + IP + 日期(Asia/Shanghai)
function buildDedupKey(event, ip) {
  const target = event.target || event.element || event.pageUrl || '';
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return crypto.createHash('sha1')
    .update(`${event.eventType}|${target}|${ip}|${day}`)
    .digest('hex');
}

// 写入单条事件：重复时 dupCount+1，不重复落库
async function insertEvent(event) {
  try {
    await db.collection('events').insertOne(event);
    return { stored: true };
  } catch (err) {
    if (err.code === 11000) {
      await db.collection('events').updateOne(
        { dedupKey: event.dedupKey },
        { $inc: { dupCount: 1 }, $set: { lastDupAt: new Date() } }
      );
      return { stored: false };
    }
    throw err;
  }
}

// 组装服务端字段并落库（数组入，结果出）
async function storeEvents(payloads, req) {
  const ip = getClientIP(req);
  const userAgent = req.get('User-Agent');
  let stored = 0, deduped = 0;
  for (const item of payloads) {
    const event = {
      ...item,
      eventTime: new Date(),
      userAgent,
      ip
    };
    event.dedupKey = buildDedupKey(event, ip);
    const r = await insertEvent(event);
    r.stored ? stored++ : deduped++;
  }
  return { stored, deduped };
}

function getClientIP(req) {
  return req.headers['x-real-ip'] ||
         req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.ip ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress;
}

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/track', async (req, res) => {
  try {
    const { stored, deduped } = await storeEvents([req.body || {}], req);
    res.json({ status: 'ok', stored, deduped });
  } catch (error) {
    console.error('上报失败:', error);
    res.status(500).json({ error: '保存失败' });
  }
});

app.post('/api/track/batch', async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      console.error('批量上报格式错误，期望数组，收到:', typeof req.body);
      return res.status(400).json({ error: '期望数组格式' });
    }

    const { stored, deduped } = await storeEvents(req.body, req);
    res.json({ status: 'ok', stored, deduped });
  } catch (error) {
    console.error('批量上报失败:', error);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/stats/pv', async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = req.query.end ? new Date(req.query.end) : new Date();
    end.setHours(23, 59, 59, 999);

    const pipeline = [
      { $match: { eventTime: { $gte: start, $lte: end }, eventType: 'pv' } },
      { $group: { _id: '$pageUrl', pv: { $sum: 1 }, uv: { $addToSet: '$userId' } } },
      { $project: { page: '$_id', pv: 1, uv: { $size: '$uv' } } },
      { $sort: { pv: -1 } }
    ];

    const results = await db.collection('events').aggregate(pipeline).toArray();
    res.json({ data: results, start, end });
  } catch (error) {
    console.error('统计失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/stats/path', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const events = await db.collection('events')
      .find({ userId })
      .sort({ eventTime: 1 })
      .limit(100)
      .toArray();

    res.json({ userId, events, count: events.length });
  } catch (error) {
    console.error('路径查询失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/stats/funnel', async (req, res) => {
  try {
    const steps = req.query.steps || [];
    const stepArray = Array.isArray(steps) ? steps : [steps];

    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = req.query.end ? new Date(req.query.end) : new Date();
    end.setHours(23, 59, 59, 999);

    const funnel = [];
    for (const step of stepArray) {
      const count = await db.collection('events').countDocuments({
        eventTime: { $gte: start, $lte: end },
        eventType: step
      });
      funnel.push({ step, count });
    }

    res.json({ funnel, start, end });
  } catch (error) {
    console.error('漏斗查询失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/stats/realtime', async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 5;
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const [totalEvents, uniqueUsers, topPages] = await Promise.all([
      db.collection('events').countDocuments({ eventTime: { $gte: since } }),
      db.collection('events').distinct('userId', { eventTime: { $gte: since } }),
      db.collection('events').aggregate([
        { $match: { eventTime: { $gte: since }, eventType: 'pv' } },
        { $group: { _id: '$pageUrl', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray()
    ]);

    res.json({
      totalEvents,
      uniqueUsers: uniqueUsers.length,
      topPages,
      since
    });
  } catch (error) {
    console.error('实时统计失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

async function start() {
  await connectMongo();
  app.listen(PORT, () => {
    console.log(`埋点服务启动成功 http://localhost:${PORT}`);
  });
}

start();
