const DEFAULT_SETTINGS = {
  music: true,
  sound: true,
  volume: 0.7,
  quality: 'high',
  control: 'keyboard',
  autoFire: false
};

const GAME_CONFIG = {
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
};

const SESSION_COOKIE = "space_strike_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await routeApi(request, env, url);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Static assets binding is missing.", { status: 500 });
    } catch (error) {
      console.error("Worker request failed", {
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.stack || error.message : String(error)
      });

      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof HttpError ? error.message : "服务内部错误";

      return jsonResponse(
        {
          success: false,
          message
        },
        statusCode
      );
    }
  }
};

async function routeApi(request, env, url) {
  assertBindings(env);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({
      success: true,
      now: new Date().toISOString(),
      runtime: "cloudflare-workers"
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return jsonResponse({
      success: true,
      config: GAME_CONFIG
    });
  }

  if (request.method === "POST" && url.pathname === "/api/register") {
    return handleRegister(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    return handleLogin(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    return handleLogout(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    return handleMe(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/scores") {
    return handleSaveScore(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    return handleLeaderboard(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/my-scores") {
    return handleMyScores(request, env);
  }

  throw new HttpError(404, "接口不存在");
}

async function handleRegister(request, env) {
  const payload = await parseJsonBody(request);
  const { account, nickname, password } = validateRegisterPayload(payload);
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await env.DB.prepare(
      `
        INSERT INTO users (id, account, nickname, password_hash, settings_json, created_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(userId, account, nickname, passwordHash, JSON.stringify(DEFAULT_SETTINGS), now, now)
      .run();
  } catch (error) {
    console.error("Register insert failed", error);
    if (String(error.message || error).includes("UNIQUE")) {
      throw new HttpError(409, "该账号已被注册");
    }
    throw error;
  }

  const user = {
    id: userId,
    account,
    nickname,
    settings_json: JSON.stringify(DEFAULT_SETTINGS),
    created_at: now,
    last_login_at: now
  };

  return createSessionResponse(request, env, user, {
    success: true,
    user: publicUser(user)
  });
}

async function handleLogin(request, env) {
  const payload = await parseJsonBody(request);
  const account = String(payload.account || "").trim();
  const password = String(payload.password || "");

  if (!account || !password) {
    throw new HttpError(400, "请输入账号和密码");
  }

  let user;
  try {
    user = await env.DB.prepare(
      `
        SELECT id, account, nickname, password_hash, settings_json, created_at, last_login_at
        FROM users
        WHERE account = ?
        LIMIT 1
      `
    )
      .bind(account)
      .first();
  } catch (error) {
    console.error("Login query failed", error);
    throw error;
  }

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "账号或密码错误");
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run();

  return createSessionResponse(
    request,
    env,
    {
      ...user,
      last_login_at: now
    },
    {
      success: true,
      user: publicUser({
        ...user,
        last_login_at: now
      })
    }
  );
}

async function handleLogout(request, env) {
  const session = await getSessionContext(request, env);
  const headers = new Headers();
  headers.append("Set-Cookie", buildClearedSessionCookie(request));

  if (session?.payload?.jti) {
    await env.SESSION_KV.delete(sessionKvKey(session.payload.jti));
  }

  return jsonResponse(
    {
      success: true
    },
    200,
    headers
  );
}

async function handleMe(request, env) {
  const session = await requireAuth(request, env);

  return jsonResponse({
    success: true,
    user: publicUser(session.user)
  });
}

async function handleSaveScore(request, env) {
  const session = await requireAuth(request, env);
  const payload = await parseJsonBody(request);
  const scorePayload = validateScorePayload(payload);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `
      INSERT INTO scores (id, user_id, score, kills, survival_time, max_combo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      crypto.randomUUID(),
      session.user.id,
      scorePayload.score,
      scorePayload.kills,
      scorePayload.survivalTime,
      scorePayload.maxCombo,
      now
    )
    .run();

  const rankings = await getBestScoreRankings(env);
  const myRank = rankings.find((item) => item.userId === session.user.id) || null;

  return jsonResponse({
    success: true,
    record: {
      userId: session.user.id,
      nickname: session.user.nickname,
      score: scorePayload.score,
      kills: scorePayload.kills,
      survivalTime: scorePayload.survivalTime,
      maxCombo: scorePayload.maxCombo,
      createdAt: now
    },
    myBest: myRank
      ? {
          score: myRank.score,
          rank: myRank.rank
        }
      : null
  });
}

async function handleLeaderboard(request, env) {
  const session = await getSessionContext(request, env);
  const rankings = await getBestScoreRankings(env);
  const top50 = rankings.slice(0, 50);
  const myRank = session ? rankings.find((item) => item.userId === session.user.id) || null : null;

  return jsonResponse({
    success: true,
    list: top50,
    myRank: myRank
      ? {
          rank: myRank.rank,
          score: myRank.score,
          survivalTime: myRank.survivalTime
        }
      : null
  });
}

async function handleMyScores(request, env) {
  const session = await requireAuth(request, env);

  const result = await env.DB.prepare(
    `
      SELECT id, user_id AS userId, score, kills, survival_time AS survivalTime, max_combo AS maxCombo, created_at AS createdAt
      FROM scores
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `
  )
    .bind(session.user.id)
    .all();

  return jsonResponse({
    success: true,
    list: result.results || []
  });
}

async function getBestScoreRankings(env) {
  const result = await env.DB.prepare(
    `
      SELECT user_id AS userId, nickname, score, kills, survivalTime, createdAt
      FROM (
        SELECT
          s.user_id,
          u.nickname,
          s.score,
          s.kills,
          s.survival_time AS survivalTime,
          s.created_at AS createdAt,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id
            ORDER BY s.score DESC, s.survival_time DESC, s.created_at ASC
          ) AS rowNum
        FROM scores s
        INNER JOIN users u ON u.id = s.user_id
      )
      WHERE rowNum = 1
      ORDER BY score DESC, survivalTime DESC, createdAt ASC
    `
  ).all();

  return (result.results || []).map((item, index) => ({
    rank: index + 1,
    userId: item.userId,
    nickname: item.nickname,
    score: Number(item.score),
    kills: Number(item.kills),
    survivalTime: Number(item.survivalTime),
    createdAt: item.createdAt
  }));
}

async function requireAuth(request, env) {
  const session = await getSessionContext(request, env);
  if (!session) {
    throw new HttpError(401, "请先登录");
  }
  return session;
}

async function getSessionContext(request, env) {
  const token = getAuthToken(request);
  if (!token || !env.JWT_SECRET) {
    return null;
  }

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.sub || !payload.jti) {
    return null;
  }

  const kvSession = await env.SESSION_KV.get(sessionKvKey(payload.jti), { type: "json" });
  if (!kvSession || kvSession.userId !== payload.sub) {
    return null;
  }

  const user = await env.DB.prepare(
    `
      SELECT id, account, nickname, settings_json, created_at, last_login_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(payload.sub)
    .first();

  if (!user) {
    return null;
  }

  return { payload, user };
}

function assertBindings(env) {
  if (!env.DB) {
    throw new HttpError(500, "D1 数据库绑定缺失");
  }

  if (!env.SESSION_KV) {
    throw new HttpError(500, "KV 会话绑定缺失");
  }

  if (!env.JWT_SECRET) {
    throw new HttpError(500, "JWT_SECRET 未配置");
  }
}

function validateRegisterPayload(payload) {
  const account = String(payload.account || "").trim();
  const nickname = String(payload.nickname || "").trim();
  const password = String(payload.password || "");

  if (!/^[A-Za-z0-9_]{4,20}$/.test(account)) {
    throw new HttpError(400, "账号需为 4-20 位字母/数字/下划线");
  }

  const nicknameLength = Array.from(nickname).length;
  if (nicknameLength < 2 || nicknameLength > 12) {
    throw new HttpError(400, "昵称需为 2-12 个字符");
  }

  if (password.length < 6 || password.length > 20) {
    throw new HttpError(400, "密码需为 6-20 位");
  }

  return { account, nickname, password };
}

function validateScorePayload(payload) {
  const score = Number(payload.score);
  const kills = Number(payload.kills);
  const survivalTime = Number(payload.survivalTime);
  const maxCombo = Number(payload.maxCombo);

  if (!Number.isFinite(score) || score < 0) {
    throw new HttpError(400, "分数无效");
  }

  if (!Number.isFinite(kills) || kills < 0) {
    throw new HttpError(400, "击杀数无效");
  }

  if (!Number.isFinite(survivalTime) || survivalTime < 0) {
    throw new HttpError(400, "生存时间无效");
  }

  if (!Number.isFinite(maxCombo) || maxCombo < 0) {
    throw new HttpError(400, "连击数无效");
  }

  return {
    score: Math.floor(score),
    kills: Math.floor(kills),
    survivalTime: Math.floor(survivalTime),
    maxCombo: Math.floor(maxCombo)
  };
}

async function parseJsonBody(request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON 格式错误");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    account: user.account,
    nickname: user.nickname,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    settings: parseSettings(user.settings_json)
  };
}

function parseSettings(rawSettings) {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(typeof rawSettings === "string" ? JSON.parse(rawSettings) : {})
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function createSessionResponse(request, env, user, payload) {
  const token = await createSessionToken(env, user.id);
  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(request, token));

  return jsonResponse(payload, 200, headers);
}

async function createSessionToken(env, userId) {
  if (!env.JWT_SECRET) {
    throw new HttpError(500, "JWT_SECRET 未配置");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };

  const token = await signJwt(payload, env.JWT_SECRET);
  await env.SESSION_KV.put(
    sessionKvKey(payload.jti),
    JSON.stringify({ userId }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  return token;
}

function sessionKvKey(jti) {
  return `session:${jti}`;
}

function jsonResponse(payload, statusCode = 200, extraHeaders) {
  const headers = new Headers(extraHeaders || undefined);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers
  });
}

function buildSessionCookie(request, token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; ${cookieSecurityAttribute(request)}Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function buildClearedSessionCookie(request) {
  return `${SESSION_COOKIE}=; HttpOnly; ${cookieSecurityAttribute(request)}Path=/; SameSite=Lax; Max-Age=0`;
}

function cookieSecurityAttribute(request) {
  const { hostname, protocol } = new URL(request.url);
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }
  if (protocol === "https:") {
    return "Secure; ";
  }
  return "";
}

function getAuthToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  return cookies[SESSION_COOKIE] || "";
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((acc, item) => {
    const [name, ...rest] = item.trim().split("=");
    if (!name) {
      return acc;
    }
    acc[name] = rest.join("=");
    return acc;
  }, {});
}

async function hashPassword(password) {
  const salt = randomBase64Url(16);
  const hash = await sha256Hash(password, salt);
  return `sha256$${salt}$${hash}`;
}

async function verifyPassword(password, storedValue) {
  const parts = String(storedValue || "").split("$");

  if (parts.length === 3 && parts[0] === "sha256") {
    const salt = parts[1];
    const expectedHash = parts[2];
    const actualHash = await sha256Hash(password, salt);
    return timingSafeEqual(actualHash, expectedHash);
  }

  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expectedHash = parts[3];

  if (!Number.isFinite(iterations) || !salt || !expectedHash) {
    return false;
  }

  const actualHash = await pbkdf2Hash(password, salt, iterations);
  return timingSafeEqual(actualHash, expectedHash);
}

async function sha256Hash(password, salt) {
  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return bytesToBase64Url(new Uint8Array(digest));
}

async function pbkdf2Hash(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations
    },
    keyMaterial,
    256
  );

  return bytesToBase64Url(new Uint8Array(derivedBits));
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    diff |= leftBytes[i] ^ rightBytes[i];
  }
  return diff === 0;
}

async function signJwt(payload, secret) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(signingInput, secret);

  return `${signingInput}.${signature}`;
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = await hmacSha256(signingInput, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecodeToText(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function hmacSha256(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64UrlEncodeJson(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlDecodeToText(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
