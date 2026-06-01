#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const DATA_FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  scores: path.join(DATA_DIR, 'scores.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  config: path.join(DATA_DIR, 'config.json')
};

const MAX_BODY_SIZE = 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

const DEFAULT_SETTINGS = {
  music: true,
  sound: true,
  volume: 0.7,
  quality: 'high',
  control: 'keyboard',
  autoFire: false
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

const fileWriteChains = new Map();

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function textResponse(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end(text);
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) {
    return false;
  }

  const [salt, digest] = stored.split(':');
  if (!salt || !digest) {
    return false;
  }

  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const left = Buffer.from(candidate, 'hex');
  const right = Buffer.from(digest, 'hex');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function publicUser(user) {
  return {
    id: user.id,
    account: user.account,
    nickname: user.nickname,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    settings: user.settings || DEFAULT_SETTINGS
  };
}

async function ensureJsonFile(filePath, defaultData) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await Promise.all([
    ensureJsonFile(DATA_FILES.users, []),
    ensureJsonFile(DATA_FILES.scores, []),
    ensureJsonFile(DATA_FILES.sessions, []),
    ensureJsonFile(DATA_FILES.config, {
      game: {
        playerHp: 3,
        playerSpeed: 320,
        enemyBaseSpeed: 120,
        enemySpawnInterval: 1000,
        difficultyIncreaseInterval: 30000
      },
      score: {
        normalEnemy: 100,
        fastEnemy: 150,
        heavyEnemy: 500,
        shooterEnemy: 350
      }
    })
  ]);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    if (error instanceof SyntaxError) {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, serialized, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function queueJsonWrite(filePath, fallback, updater) {
  const prev = fileWriteChains.get(filePath) || Promise.resolve();
  const next = prev.then(async () => {
    const current = await readJson(filePath, fallback);
    const updated = await updater(current);
    await writeJsonAtomic(filePath, updated);
    return updated;
  });

  fileWriteChains.set(filePath, next.catch(() => {}));
  return next;
}

function validateRegisterPayload(payload) {
  const account = String(payload.account || '').trim();
  const nickname = String(payload.nickname || '').trim();
  const password = String(payload.password || '');

  if (!/^[A-Za-z0-9_]{4,20}$/.test(account)) {
    throw new HttpError(400, '账号需为 4-20 位字母/数字/下划线');
  }

  const nicknameLength = Array.from(nickname).length;
  if (nicknameLength < 2 || nicknameLength > 12) {
    throw new HttpError(400, '昵称需为 2-12 个字符');
  }

  if (password.length < 6 || password.length > 20) {
    throw new HttpError(400, '密码需为 6-20 位');
  }

  return { account, nickname, password };
}

function validateScorePayload(payload) {
  const score = Number(payload.score);
  const kills = Number(payload.kills);
  const survivalTime = Number(payload.survivalTime);
  const maxCombo = Number(payload.maxCombo);

  if (!Number.isFinite(score) || score < 0) {
    throw new HttpError(400, '分数无效');
  }

  if (!Number.isFinite(kills) || kills < 0) {
    throw new HttpError(400, '击杀数无效');
  }

  if (!Number.isFinite(survivalTime) || survivalTime < 0) {
    throw new HttpError(400, '生存时间无效');
  }

  if (!Number.isFinite(maxCombo) || maxCombo < 0) {
    throw new HttpError(400, '连击数无效');
  }

  return {
    score: Math.floor(score),
    kills: Math.floor(kills),
    survivalTime: Math.floor(survivalTime),
    maxCombo: Math.floor(maxCombo)
  };
}

async function parseJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      throw new HttpError(413, '请求体过大');
    }
  }

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'JSON 格式错误');
  }
}

async function createSession(userId) {
  const session = {
    token: `tok_${crypto.randomBytes(24).toString('hex')}`,
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
  };

  await queueJsonWrite(DATA_FILES.sessions, [], (sessions) => {
    const active = Array.isArray(sessions) ? sessions : [];
    return [...active, session];
  });

  return session;
}

async function getSessionByToken(token) {
  if (!token) {
    return null;
  }

  const sessions = await readJson(DATA_FILES.sessions, []);
  const active = Array.isArray(sessions) ? sessions : [];
  const current = active.find((item) => item.token === token);

  if (!current) {
    return null;
  }

  if (new Date(current.expiresAt).getTime() < Date.now()) {
    await queueJsonWrite(DATA_FILES.sessions, [], (list) => {
      const safeList = Array.isArray(list) ? list : [];
      return safeList.filter((item) => item.token !== token);
    });
    return null;
  }

  return current;
}

function getAuthToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

function compareScoreRecord(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.survivalTime !== left.survivalTime) {
    return right.survivalTime - left.survivalTime;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function buildLeaderboard(scores) {
  const allScores = Array.isArray(scores) ? scores : [];
  const bestByUser = new Map();

  for (const record of allScores) {
    const existing = bestByUser.get(record.userId);
    if (!existing || compareScoreRecord(record, existing) < 0) {
      bestByUser.set(record.userId, record);
    }
  }

  const bestList = Array.from(bestByUser.values()).sort(compareScoreRecord);

  return bestList.map((item, index) => ({
    rank: index + 1,
    userId: item.userId,
    nickname: item.nickname,
    score: item.score,
    kills: item.kills,
    survivalTime: item.survivalTime,
    createdAt: item.createdAt
  }));
}

async function authenticate(req) {
  const token = getAuthToken(req);
  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  const session = await getSessionByToken(token);
  if (!session) {
    throw new HttpError(401, '登录已失效，请重新登录');
  }

  const users = await readJson(DATA_FILES.users, []);
  const safeUsers = Array.isArray(users) ? users : [];
  const user = safeUsers.find((item) => item.id === session.userId);
  if (!user) {
    throw new HttpError(401, '用户不存在');
  }

  return { token, session, user };
}

async function handleRegister(req, res) {
  const payload = await parseJsonBody(req);
  const { account, nickname, password } = validateRegisterPayload(payload);

  let createdUser = null;

  await queueJsonWrite(DATA_FILES.users, [], (users) => {
    const safeUsers = Array.isArray(users) ? users : [];

    if (safeUsers.some((item) => item.account === account)) {
      throw new HttpError(409, '该账号已被注册');
    }

    const user = {
      id: randomId('u'),
      account,
      nickname,
      passwordHash: hashPassword(password),
      settings: { ...DEFAULT_SETTINGS },
      createdAt: nowIso(),
      lastLoginAt: nowIso()
    };

    createdUser = user;
    return [...safeUsers, user];
  });

  const session = await createSession(createdUser.id);

  jsonResponse(res, 200, {
    success: true,
    token: session.token,
    user: publicUser(createdUser)
  });
}

async function handleLogin(req, res) {
  const payload = await parseJsonBody(req);
  const account = String(payload.account || '').trim();
  const password = String(payload.password || '');

  if (!account || !password) {
    throw new HttpError(400, '请输入账号和密码');
  }

  const users = await readJson(DATA_FILES.users, []);
  const safeUsers = Array.isArray(users) ? users : [];
  const user = safeUsers.find((item) => item.account === account);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, '账号或密码错误');
  }

  let updatedUser = null;

  await queueJsonWrite(DATA_FILES.users, [], (list) => {
    const safeList = Array.isArray(list) ? list : [];
    return safeList.map((item) => {
      if (item.id !== user.id) {
        return item;
      }

      updatedUser = {
        ...item,
        lastLoginAt: nowIso()
      };
      return updatedUser;
    });
  });

  const session = await createSession(user.id);

  jsonResponse(res, 200, {
    success: true,
    token: session.token,
    user: publicUser(updatedUser || user)
  });
}

async function handleLogout(req, res) {
  const token = getAuthToken(req);
  if (!token) {
    jsonResponse(res, 200, { success: true });
    return;
  }

  await queueJsonWrite(DATA_FILES.sessions, [], (sessions) => {
    const safeSessions = Array.isArray(sessions) ? sessions : [];
    return safeSessions.filter((item) => item.token !== token);
  });

  jsonResponse(res, 200, { success: true });
}

async function handleMe(req, res) {
  const { user } = await authenticate(req);
  jsonResponse(res, 200, {
    success: true,
    user: publicUser(user)
  });
}

async function handleSaveScore(req, res) {
  const { user } = await authenticate(req);
  const payload = await parseJsonBody(req);
  const scorePayload = validateScorePayload(payload);

  const record = {
    id: randomId('s'),
    userId: user.id,
    nickname: user.nickname,
    score: scorePayload.score,
    kills: scorePayload.kills,
    survivalTime: scorePayload.survivalTime,
    maxCombo: scorePayload.maxCombo,
    createdAt: nowIso()
  };

  await queueJsonWrite(DATA_FILES.scores, [], (scores) => {
    const safeScores = Array.isArray(scores) ? scores : [];
    return [...safeScores, record];
  });

  const allScores = await readJson(DATA_FILES.scores, []);
  const leaderboard = buildLeaderboard(allScores);
  const myBest = leaderboard.find((item) => item.userId === user.id);

  jsonResponse(res, 200, {
    success: true,
    record,
    myBest: myBest
      ? {
          score: myBest.score,
          rank: myBest.rank
        }
      : null
  });
}

async function handleLeaderboard(req, res) {
  const token = getAuthToken(req);
  const session = token ? await getSessionByToken(token) : null;
  const userId = session ? session.userId : null;

  const scores = await readJson(DATA_FILES.scores, []);
  const leaderboard = buildLeaderboard(scores);
  const top = leaderboard.slice(0, 50);
  const myRank = userId ? leaderboard.find((item) => item.userId === userId) || null : null;

  jsonResponse(res, 200, {
    success: true,
    list: top,
    myRank: myRank
      ? {
          rank: myRank.rank,
          score: myRank.score,
          survivalTime: myRank.survivalTime
        }
      : null
  });
}

async function handleMyScores(req, res) {
  const { user } = await authenticate(req);
  const scores = await readJson(DATA_FILES.scores, []);
  const safeScores = Array.isArray(scores) ? scores : [];

  const list = safeScores
    .filter((item) => item.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  jsonResponse(res, 200, {
    success: true,
    list
  });
}

async function handleConfig(_req, res) {
  const config = await readJson(DATA_FILES.config, {});
  jsonResponse(res, 200, {
    success: true,
    config
  });
}

async function serveStatic(req, res, urlObject) {
  const pathname = decodeURIComponent(urlObject.pathname);
  const relativePath = pathname === '/' ? '/index.html' : pathname;

  let filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw new HttpError(403, '禁止访问');
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    throw new HttpError(404, '资源不存在');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = await fs.readFile(filePath);

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(content);
}

async function routeApi(req, res, urlObject) {
  const { pathname } = urlObject;

  if (req.method === 'GET' && pathname === '/api/health') {
    jsonResponse(res, 200, { success: true, now: nowIso() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    await handleRegister(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    await handleLogin(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    await handleLogout(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    await handleMe(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    await handleConfig(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/scores') {
    await handleSaveScore(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    await handleLeaderboard(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/my-scores') {
    await handleMyScores(req, res);
    return;
  }

  throw new HttpError(404, '接口不存在');
}

async function requestListener(req, res) {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const urlObject = new URL(req.url || '/', `http://${host}`);

    if (urlObject.pathname.startsWith('/api/')) {
      await routeApi(req, res, urlObject);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, '不支持该请求方法');
    }

    await serveStatic(req, res, urlObject);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务内部错误';

    if ((req.url || '').startsWith('/api/')) {
      jsonResponse(res, statusCode, {
        success: false,
        message
      });
      return;
    }

    textResponse(res, statusCode, message);
  }
}

async function start() {
  await ensureDataFiles();

  const server = http.createServer(requestListener);
  server.listen(PORT, HOST, () => {
    console.log(`Space Strike server is running at http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
