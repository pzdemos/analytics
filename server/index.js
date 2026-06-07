const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const PORT = 9090;

const MONGO_URI = 'mongodb://localhost:16016';
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
    console.log('索引创建成功');
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    process.exit(1);
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
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
    const event = {
      _id: generateId(),
      ...req.body,
      eventTime: new Date(),
      userAgent: req.get('User-Agent'),
      ip: getClientIP(req)
    };

    await db.collection('events').insertOne(event);
    res.json({ status: 'ok', id: event._id });
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

    const events = req.body.map(event => ({
      _id: generateId(),
      ...event,
      eventTime: new Date(),
      userAgent: req.get('User-Agent'),
      ip: getClientIP(req)
    }));

    await db.collection('events').insertMany(events);
    res.json({ status: 'ok', count: events.length });
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
