/**
 * 仪表盘业务逻辑（从 dashboard-server.js 移植到 Cloudflare Pages Functions）。
 * 差异：
 *  - 数据库由 node:sqlite → Cloudflare D1（异步），DB 句柄经参数 `db`(env 绑定) 传入
 *  - token 密文由 token_config.json → D1 表 config(key='token_cipher')
 *  - 出站请求由 node:https → 全局 fetch
 *  - 错误日志由写文件 → console.log（可在 wrangler tail / 控制台查看）
 *  - 去掉 git push / systemctl 重启等服务器运维逻辑
 */
import smCrypto from 'sm-crypto';

const sm4 = smCrypto.sm4;

export const KEY_HEX = '62316238663530333733373835366437';

// AI 密钥不再硬编码，改由 Cloudflare Secret 提供（DASHSCOPE_API_KEY / OPENAI_API_KEY 等）
export const DEFAULT_AI_DASHSCOPE_KEY = '';
export const DEFAULT_AI_DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_AI_DASHSCOPE_MODEL = 'qwen-turbo';

export const TOKEN_INVALID_MSG = 'token失效了，请联系管理员';

export const DAILY_SOURCE_MAP = {
  weibo: {
    key: 'weibo',
    chartId: 'weibo_day_min',
    path: '/wx/tf/weibo/day/min',
    title: '微博指定日榜',
    body: { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: 'fansNum' }
  },
  weibo_super_fan: {
    key: 'weibo_super_fan',
    chartId: 'super_fans_day',
    path: '/wx/tf/super/fans/day/min',
    title: '个人超话涨粉日榜',
    body: { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: 'fansNum' }
  },
  weibo_super_sign: {
    key: 'weibo_super_sign',
    chartId: 'super_all_day',
    path: '/wx/tf/super/all/day',
    title: '个人超话签到日榜',
    body: { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: 'signNum' }
  },
  dy_topic: {
    key: 'dy_topic',
    chartId: 'dy_topic_day',
    path: '/wx/tf/dy/topic/day/min',
    title: '抖音个人话题日榜',
    body: { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: 'fansNum' }
  },
  xhs_topic: {
    key: 'xhs_topic',
    chartId: 'xhs_topic_day',
    path: '/wx/tf/xhs/topic/day/min',
    title: '小红书话题日榜',
    body: { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: 'fansNum' }
  }
};

export const CURRENT_TREND_SOURCE_MAP = {
  weibo: { key: 'weibo', path: '/wx/tf/weibo/week/min', flied: 'fansNum', title: '微博当日趋势' },
  weibo_super_fan: {
    key: 'weibo_super_fan',
    path: '/wx/tf/weibo/week/min',
    flied: 'fansNum',
    title: '个人超话涨粉-当日数据（主微博小时趋势·粉丝）'
  },
  weibo_super_sign: {
    key: 'weibo_super_sign',
    path: '/wx/tf/weibo/week/min',
    flied: 'signNum',
    title: '个人超话签到-当日数据（主微博小时趋势·签到）'
  },
  dy_topic: { key: 'dy_topic', path: '/wx/tf/dy/topic/week/min', flied: 'fansNum', title: '抖音个人话题当日趋势' },
  xhs_topic: { key: 'xhs_topic', path: '/wx/tf/xhs/topic/week/min', flied: 'fansNum', title: '小红书话题当日趋势' }
};

// ── 日期/时间（北京时间）────────────────────────────────────────
export function beijingTimeStr(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function beijingDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

export function isBeijingToday(dateKey) {
  return dateKey === beijingDateStr();
}

export function parseExpireTime(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') return new Date(v).getTime();
  return null;
}

export function appendErrorLog(entry) {
  try {
    const ts = beijingTimeStr(entry.time || new Date());
    console.log(`[北京时间 ${ts}]\t${JSON.stringify(entry)}`);
  } catch (_) {}
}

// ── 范围回填计划（移植自 utils/rangeBackfillPlanner.js）────────────
function parseDateKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((v) => Number(v));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function formatDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function monthStartOf(dateKey) {
  const d = parseDateKey(dateKey);
  d.setUTCDate(1);
  return d;
}
function monthEndOf(dateKey) {
  const d = parseDateKey(dateKey);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d;
}
function datesBetween(startKey, endKey) {
  const out = [];
  let cursor = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  while (cursor.getTime() <= end.getTime()) {
    out.push(formatDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}
function getWeekInfo(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setHours(0, 0, 0, 0);
  const year = d.getFullYear();
  const week = Math.ceil((d - new Date(year, 0, 1)) / 86400000 / 7) || 1;
  return { year, week };
}
function isConsecutiveDateList(dateList) {
  if (!Array.isArray(dateList) || dateList.length <= 1) return true;
  for (let i = 1; i < dateList.length; i += 1) {
    const prev = parseDateKey(dateList[i - 1]);
    const next = parseDateKey(dateList[i]);
    if (addDays(prev, 1).getTime() !== next.getTime()) return false;
  }
  return true;
}
export function buildBackfillPlanFromDates(dateList, rangeStartDate, rangeEndDate, options) {
  const uniqSorted = Array.from(new Set((dateList || []).filter(Boolean))).sort();
  if (!uniqSorted.length) return [];
  const startKey = rangeStartDate || uniqSorted[0];
  const endKey = rangeEndDate || uniqSorted[uniqSorted.length - 1];

  if (options && options.dayOnly) {
    return uniqSorted
      .filter((d) => d >= startKey && d <= endKey)
      .map((dateKey) => ({ type: 'day', dateKey, startDate: dateKey }));
  }

  const remaining = new Set(uniqSorted.filter((d) => d >= startKey && d <= endKey));
  const plans = [];

  let monthCursor = monthStartOf(startKey);
  const endMonthStart = monthStartOf(endKey);
  while (monthCursor.getTime() <= endMonthStart.getTime()) {
    const monthStartKey = formatDateKey(monthCursor);
    const monthEndKey = formatDateKey(monthEndOf(monthStartKey));
    if (monthStartKey >= startKey && monthEndKey <= endKey) {
      const monthDates = datesBetween(monthStartKey, monthEndKey);
      if (monthDates.every((d) => remaining.has(d))) {
        const y = monthCursor.getUTCFullYear();
        const m = monthCursor.getUTCMonth() + 1;
        plans.push({ type: 'month', year: y, month: m, dates: monthDates, startDate: monthStartKey });
        monthDates.forEach((d) => remaining.delete(d));
      }
    }
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1, 1);
  }

  const weekBuckets = new Map();
  Array.from(remaining)
    .sort()
    .forEach((dateKey) => {
      const { year, week } = getWeekInfo(dateKey);
      const key = `${year}-w${week}`;
      if (!weekBuckets.has(key)) weekBuckets.set(key, { type: 'week', year, week, dates: [] });
      weekBuckets.get(key).dates.push(dateKey);
    });
  Array.from(weekBuckets.values()).forEach((bucket) => {
    bucket.dates.sort();
    if (bucket.dates.length !== 7) return;
    if (!isConsecutiveDateList(bucket.dates)) return;
    if (bucket.dates[bucket.dates.length - 1] >= endKey) return;
    plans.push({ ...bucket, startDate: bucket.dates[0] });
    bucket.dates.forEach((d) => remaining.delete(d));
  });

  Array.from(remaining)
    .sort()
    .forEach((dateKey) => {
      plans.push({ type: 'day', dateKey, startDate: dateKey });
    });

  plans.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return plans;
}

export function summarizeFetchLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  const codeCount = {};
  let weekRequests = 0;
  let dayRequests = 0;
  let fallbackDayRequests = 0;
  list.forEach((item) => {
    const code = item && item.code != null ? String(item.code) : 'unknown';
    codeCount[code] = (codeCount[code] || 0) + 1;
    const vars = item && item.vars ? item.vars : {};
    if (vars.year != null && vars.week != null) {
      weekRequests += 1;
    } else if (vars.startDate) {
      dayRequests += 1;
      if (vars.fallbackFromWeek) fallbackDayRequests += 1;
    }
  });
  return { total: list.length, codeCount, weekRequests, dayRequests, fallbackDayRequests };
}

// ── token 密文（D1 config 表）─────────────────────────────────────
export function decodeCipherPayload(cipher) {
  if (!cipher || typeof cipher !== 'string') throw new Error('token_config 中缺少 cipher');
  const raw = sm4.decrypt(cipher.trim(), KEY_HEX, { mode: 'ecb', inputEncoding: 'hex', outputEncoding: 'utf8' });
  return JSON.parse(raw);
}

async function readTokenCipher(db) {
  const row = await db.prepare("SELECT value FROM config WHERE key='token_cipher'").first();
  return row && row.value ? String(row.value).trim() : '';
}

async function writeTokenCipher(db, cipher) {
  await db
    .prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('token_cipher', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    )
    .bind(String(cipher), Date.now())
    .run();
}

export async function readTokenConfigSession(db) {
  const cipher = await readTokenCipher(db);
  if (!cipher) {
    return { ok: false, error: '缺少 token 密文，请先在看板写入最新密文', session: null };
  }
  try {
    const payload = decodeCipherPayload(cipher);
    const expireTime = parseExpireTime(payload.expireTime);
    const updateTime = parseExpireTime(payload.updateTime);
    const now = Date.now();
    if (!payload.token) {
      return { ok: false, error: '密文解密成功，但未得到 token', session: null };
    }
    if (expireTime != null && expireTime <= now) {
      return {
        ok: true,
        expired: true,
        error: 'token 已过期，请手动更新密文',
        session: null,
        cipher,
        expireTime,
        updateTime
      };
    }
    return {
      ok: true,
      expired: false,
      cipher,
      session: {
        token: payload.token,
        expireTime,
        updateTime,
        openid: payload.openid || null,
        id: payload.id || null
      },
      expireTime,
      updateTime
    };
  } catch (e) {
    return { ok: false, error: `读取 token 密文失败: ${e.message}`, session: null };
  }
}

export function validateIncomingCipher(cipher) {
  const trimmed = String(cipher || '').trim();
  if (!trimmed) throw new Error('缺少密文');
  const payload = decodeCipherPayload(trimmed);
  const expireTime = parseExpireTime(payload.expireTime);
  const updateTime = parseExpireTime(payload.updateTime);
  const now = Date.now();
  if (!payload.token) throw new Error('密文解密成功，但未得到 token');
  if (expireTime != null && expireTime <= now) throw new Error('token 已过期，请使用未过期的密文');
  return { cipher: trimmed, payload, expireTime, updateTime, token: payload.token };
}

export async function saveTokenCipher(db, cipher) {
  await writeTokenCipher(db, cipher);
}

// ── 出站数据请求（m.cbeeyi.top）─────────────────────────────────
export async function requestCloudJson(urlPath, method, token, body) {
  const bodyString = body ? JSON.stringify(body) : '';
  const startedAt = Date.now();
  try {
    const resp = await fetch(`https://m.cbeeyi.top${urlPath}`, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        ...(token ? { token } : {})
      },
      body: bodyString || undefined
    });
    const raw = await resp.text();
    try {
      const json = JSON.parse(raw);
      let data = json.data;
      if (typeof data === 'string' && /^[0-9a-fA-F]+$/.test(data)) {
        try {
          const plain = sm4.decrypt(data, KEY_HEX, { mode: 'ecb', inputEncoding: 'hex', outputEncoding: 'utf8' });
          data = JSON.parse(plain);
        } catch (_) {}
      }
      return {
        status: resp.status,
        code: json.code,
        msg: json.msg,
        data,
        elapsed: Date.now() - startedAt,
        raw: raw.slice(0, 500)
      };
    } catch (e) {
      return { status: resp.status, code: 0, msg: e.message, data: null, elapsed: Date.now() - startedAt, raw: raw.slice(0, 500) };
    }
  } catch (e) {
    return { status: 0, code: 0, msg: e.message, data: null, elapsed: Date.now() - startedAt };
  }
}

// 远端 token 可用性校验（60s 内存缓存，仅在暖 isolate 内有效）
const REMOTE_VERIFY_TTL_MS = 60000;
let remoteVerifyCache = { token: null, at: 0, remoteValid: null, remoteMsg: null };
export function resetRemoteVerifyCache() {
  remoteVerifyCache = { token: null, at: 0, remoteValid: null, remoteMsg: null };
}

export async function verifyRemoteTokenUsage(token, { force } = {}) {
  if (!token) return { remoteValid: null, remoteMsg: null };
  const now = Date.now();
  if (!force && remoteVerifyCache.token === token && now - remoteVerifyCache.at < REMOTE_VERIFY_TTL_MS) {
    return { remoteValid: remoteVerifyCache.remoteValid, remoteMsg: remoteVerifyCache.remoteMsg };
  }
  const source = CURRENT_TREND_SOURCE_MAP.weibo;
  const body = { desc: true, type: '4', timeType: 0, timeTypeName: 'day', flied: source.flied, startDate: beijingDateStr() };
  const result = await requestCloudJson(source.path, 'POST', token, body);
  let remoteValid;
  let remoteMsg = null;
  if (result.status === 0) {
    remoteValid = null;
    remoteMsg = result.msg || '网络不可达';
  } else if (result.code === 200 && result.data != null) {
    remoteValid = true;
  } else {
    remoteValid = false;
    remoteMsg = result.msg || '云端拒绝';
  }
  remoteVerifyCache = { token, at: now, remoteValid, remoteMsg };
  return { remoteValid, remoteMsg };
}

// ── 数据校验/解析 ────────────────────────────────────────────────
export function parsePayloadObject(data) {
  if (data == null) return null;
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (_) {
      return null;
    }
  }
  return null;
}
export function isValidDailyChartPayload(data) {
  const o = parsePayloadObject(data);
  if (!o || typeof o !== 'object') return false;
  if (Array.isArray(o.ts) && o.ts.length > 0) return true;
  if (Array.isArray(o.tops) && o.tops.length > 0) return true;
  return false;
}
export function isValidCurrentTrendPayload(data) {
  const o = parsePayloadObject(data);
  if (!o || typeof o !== 'object') return false;
  if (!Array.isArray(o.tl) || o.tl.length === 0) return false;
  if (!Array.isArray(o.d) || o.d.length === 0) return false;
  return true;
}

// ── 日期区间/覆盖率 ──────────────────────────────────────────────
export function listDateRange(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);
  while (cursor.getTime() <= end.getTime()) {
    result.push(beijingDateStr(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
export function sanitizeRange(startDate, endDate) {
  let start = (startDate || '').trim();
  let end = (endDate || '').trim();
  if (!start) start = beijingDateStr();
  if (!end) end = start;
  if (start > end) end = start;
  return { startDate: start, endDate: end };
}
function buildDailyCoverageMap(data) {
  const coverage = {};
  Object.values(DAILY_SOURCE_MAP).forEach((source) => {
    coverage[source.chartId] = new Set();
  });
  Object.keys(data || {}).forEach((chartId) => {
    const list = data[chartId];
    if (!Array.isArray(list)) return;
    if (!coverage[chartId]) coverage[chartId] = new Set();
    list.forEach((entry) => {
      const dateKey = entry && entry.vars ? entry.vars.startDate : '';
      if (!dateKey) return;
      if (!isValidDailyChartPayload(entry.data)) return;
      coverage[chartId].add(dateKey);
    });
  });
  return coverage;
}
export function getMissingDailyDates(startDate, endDate, data) {
  const allDates = listDateRange(startDate, endDate);
  const coverage = buildDailyCoverageMap(data);
  const missingByPlatform = {};
  let missingCount = 0;
  Object.keys(DAILY_SOURCE_MAP).forEach((platformKey) => {
    const source = DAILY_SOURCE_MAP[platformKey];
    missingByPlatform[platformKey] = [];
    allDates.forEach((dateKey) => {
      if (coverage[source.chartId] && coverage[source.chartId].has(dateKey)) return;
      missingByPlatform[platformKey].push(dateKey);
      missingCount += 1;
    });
  });
  return { missingByPlatform, missingCount };
}

// ── 日志构造 ─────────────────────────────────────────────────────
export function buildLog({ id, name, vars, request, result }) {
  return {
    id,
    name,
    vars: vars || {},
    request,
    status: result.status,
    code: result.code,
    msg: result.msg || null,
    err: result.code === 200 ? null : result.msg || '请求失败',
    elapsed: result.elapsed,
    time: new Date().toISOString(),
    response: result.data != null ? result.data : null
  };
}
export function cloudRequestFailed(result) {
  return result.status === 0 || result.code !== 200 || result.data == null;
}
export function buildTokenExpiredLogEntry(log, extra) {
  return {
    type: 'token_expired',
    id: log && log.id ? log.id : null,
    name: log && log.name ? log.name : null,
    vars: log && log.vars ? log.vars : {},
    request: log && log.request ? log.request : null,
    status: log && log.status != null ? log.status : null,
    code: log && log.code != null ? log.code : null,
    msg: log && log.msg ? log.msg : 'token失效，请重新登录',
    err: 'token失效，请重新登录',
    elapsed: log && log.elapsed != null ? log.elapsed : null,
    time: new Date().toISOString(),
    ...extra
  };
}

// ── D1 读写 ──────────────────────────────────────────────────────
export async function saveDailySnapshot(db, platformKey, chartId, dateKey, payload) {
  if (isBeijingToday(dateKey)) return;
  await db
    .prepare(
      `INSERT INTO daily_snapshots (platform_key, chart_id, date_key, payload_json, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(platform_key, date_key) DO UPDATE SET
         chart_id = excluded.chart_id,
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at`
    )
    .bind(platformKey, chartId, dateKey, JSON.stringify(payload), Date.now())
    .run();
}

export async function saveCurrentTrendSnapshot(db, platformKey, dayKey, payload) {
  if (isBeijingToday(dayKey)) return;
  await db
    .prepare(
      `INSERT INTO current_trend_snapshots (platform_key, day_key, payload_json, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(platform_key, day_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at`
    )
    .bind(platformKey, dayKey, JSON.stringify(payload), Date.now())
    .run();
}

export async function loadDailyDataRange(db, startDate, endDate) {
  const today = beijingDateStr();
  const { results } = await db
    .prepare(
      `SELECT platform_key, chart_id, date_key, payload_json
       FROM daily_snapshots WHERE date_key >= ? AND date_key <= ? ORDER BY date_key ASC`
    )
    .bind(startDate, endDate)
    .all();
  const data = {};
  (results || []).forEach((row) => {
    if (row.date_key === today) return;
    let parsed;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch (_) {
      return;
    }
    if (!isValidDailyChartPayload(parsed)) return;
    if (!data[row.chart_id]) data[row.chart_id] = [];
    data[row.chart_id].push({ vars: { startDate: row.date_key }, data: parsed });
  });
  return data;
}

async function selectLatestCurrentTrend(db, platformKey) {
  return db
    .prepare(
      `SELECT platform_key, day_key, payload_json FROM current_trend_snapshots
       WHERE platform_key = ? ORDER BY day_key DESC, fetched_at DESC LIMIT 1`
    )
    .bind(platformKey)
    .first();
}

export async function loadStaleCurrentTrendForPlatform(db, platformKey) {
  const latest = await selectLatestCurrentTrend(db, platformKey);
  if (!latest) return null;
  try {
    const o = JSON.parse(latest.payload_json);
    return isValidCurrentTrendPayload(o) ? o : null;
  } catch (_) {
    return null;
  }
}

export async function loadCurrentTrendMap(db, dayKey = beijingDateStr()) {
  if (isBeijingToday(dayKey)) return {};
  const { results } = await db
    .prepare(
      `SELECT platform_key, day_key, payload_json FROM current_trend_snapshots
       WHERE day_key = ? ORDER BY fetched_at DESC`
    )
    .bind(dayKey)
    .all();
  const map = {};
  (results || []).forEach((row) => {
    if (map[row.platform_key]) return;
    try {
      const o = JSON.parse(row.payload_json);
      if (!isValidCurrentTrendPayload(o)) return;
      map[row.platform_key] = o;
    } catch (_) {}
  });
  for (const platformKey of Object.keys(CURRENT_TREND_SOURCE_MAP)) {
    if (map[platformKey]) continue;
    const latest = await selectLatestCurrentTrend(db, platformKey);
    if (!latest) continue;
    try {
      const o = JSON.parse(latest.payload_json);
      if (!isValidCurrentTrendPayload(o)) continue;
      map[platformKey] = o;
    } catch (_) {}
  }
  return map;
}

export async function loadCurrentTrendMapWithStaleFallback(db, dayKey = beijingDateStr()) {
  const base = await loadCurrentTrendMap(db, dayKey);
  const out = { ...base };
  for (const platformKey of Object.keys(CURRENT_TREND_SOURCE_MAP)) {
    if (out[platformKey]) continue;
    const stale = await loadStaleCurrentTrendForPlatform(db, platformKey);
    if (stale) out[platformKey] = stale;
  }
  return out;
}

export function mergeTodayDailyIntoData(baseData, todayByChart) {
  const today = beijingDateStr();
  const out = { ...baseData };
  Object.keys(todayByChart || {}).forEach((chartId) => {
    const list = (todayByChart[chartId] || []).filter((e) => e && isValidDailyChartPayload(e.data));
    if (!list.length) return;
    if (!out[chartId]) out[chartId] = [];
    out[chartId] = out[chartId].filter((e) => e && e.vars && e.vars.startDate !== today);
    out[chartId].push(...list);
    out[chartId].sort((a, b) => (a.vars.startDate < b.vars.startDate ? -1 : 1));
  });
  return out;
}

// ── 云端拉取 ─────────────────────────────────────────────────────
export async function fetchDailySnapshot(db, platformKey, token, dateKey, options = {}) {
  const source = DAILY_SOURCE_MAP[platformKey];
  const body = { ...source.body, startDate: dateKey };
  const result = await requestCloudJson(source.path, 'POST', token, body);
  const log = buildLog({
    id: source.chartId,
    name: source.title,
    vars: { startDate: dateKey },
    request: { url: source.path, method: 'POST', vars: { startDate: dateKey }, body },
    result
  });
  const chartId = source.chartId;
  if (!cloudRequestFailed(result) && isValidDailyChartPayload(result.data)) {
    await saveDailySnapshot(db, platformKey, chartId, dateKey, result.data);
    const acc = options.todayDailyByChart;
    if (isBeijingToday(dateKey) && acc) {
      if (!acc[chartId]) acc[chartId] = [];
      acc[chartId].push({ vars: { startDate: dateKey }, data: result.data });
    }
  }
  return { result, log };
}

export async function fetchCurrentTrend(db, platformKey, token) {
  const source = CURRENT_TREND_SOURCE_MAP[platformKey];
  const body = {
    desc: true,
    type: source.requestType != null ? source.requestType : '4',
    timeType: 0,
    timeTypeName: 'day',
    flied: source.flied,
    startDate: beijingDateStr()
  };
  const result = await requestCloudJson(source.path, 'POST', token, body);
  const log = buildLog({
    id: `${platformKey}_current_trend`,
    name: source.title,
    vars: { startDate: body.startDate },
    request: { url: source.path, method: 'POST', vars: { startDate: body.startDate }, body },
    result
  });
  if (!cloudRequestFailed(result) && isValidCurrentTrendPayload(result.data)) {
    await saveCurrentTrendSnapshot(db, platformKey, body.startDate, result.data);
  }
  return { result, log };
}

export async function refreshDashboardData(db, missingDatesByPlatform, token, range, options = {}) {
  const dayOnly = options.dayOnly !== false;
  const todayDailyByChart = options.todayDailyByChart;
  const logs = [];
  let tokenInvalid = false;
  let tokenExpiredDetail = null;
  const fullRangeDates = listDateRange(range.startDate, range.endDate);
  const plan = buildBackfillPlanFromDates(fullRangeDates, range.startDate, range.endDate, { dayOnly: true });

  for (const platformKey of Object.keys(DAILY_SOURCE_MAP)) {
    if (tokenInvalid) break;
    const missingSet = new Set((missingDatesByPlatform[platformKey] || []).filter(Boolean));
    if (!missingSet.size) continue;
    for (const step of plan) {
      if (tokenInvalid) break;
      if (!missingSet.size) break;
      if (step.type !== 'day') continue;
      const dateKey = step.dateKey;
      if (!missingSet.has(dateKey)) continue;
      const { result, log } = await fetchDailySnapshot(db, platformKey, token, dateKey, { todayDailyByChart });
      logs.push(log);
      if (cloudRequestFailed(result)) {
        tokenInvalid = true;
        if (result.code === 401) {
          tokenExpiredDetail = buildTokenExpiredLogEntry(log, { platformKey, phase: 'day', range });
          appendErrorLog(tokenExpiredDetail);
        }
      } else if (isValidDailyChartPayload(result.data)) {
        missingSet.delete(dateKey);
      }
    }
  }
  return { logs, tokenInvalid, tokenExpiredDetail, dayOnly };
}

export async function mergeCurrentTrendsWithFreshFetch(db, token, fallbackMap) {
  const base = fallbackMap && typeof fallbackMap === 'object' ? { ...fallbackMap } : {};
  const logs = [];
  let tokenInvalid = false;
  const keys = Object.keys(CURRENT_TREND_SOURCE_MAP);

  async function pullTrend(platformKey) {
    const { result, log } = await fetchCurrentTrend(db, platformKey, token);
    return { platformKey, result, log };
  }
  function applyTrendResult(platformKey, result, log) {
    logs.push(log);
    if (result.code === 401) {
      appendErrorLog(buildTokenExpiredLogEntry(log, { platformKey, phase: 'current_trend' }));
    }
    if (!cloudRequestFailed(result) && isValidCurrentTrendPayload(result.data)) {
      base[platformKey] = result.data;
      return true;
    }
    if (cloudRequestFailed(result)) {
      tokenInvalid = true;
    }
    return false;
  }

  const first = await Promise.all(keys.map(pullTrend));
  first.forEach(({ platformKey, result, log }) => applyTrendResult(platformKey, result, log));

  const retryKeys = keys.filter((k) => !isValidCurrentTrendPayload(base[k]));
  if (!tokenInvalid && retryKeys.length > 0) {
    const second = await Promise.all(retryKeys.map(pullTrend));
    second.forEach(({ platformKey, result, log }) => {
      if (!isValidCurrentTrendPayload(base[platformKey])) applyTrendResult(platformKey, result, log);
    });
  }
  return { trends: base, logs, tokenInvalid };
}

// ── 请求/响应辅助 ────────────────────────────────────────────────
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function readJsonBody(request) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await request.json()) || {};
    const text = await request.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      const params = new URLSearchParams(text);
      const o = {};
      for (const [k, v] of params) o[k] = v;
      return o;
    }
  } catch (_) {
    return {};
  }
}

export const DAY_ONLY_BACKFILL_DEFAULT = true;
export function resolveDayOnlyBackfill(body, query) {
  if (body && typeof body.dayOnly === 'boolean') return body.dayOnly;
  if (query && (query.get('dayOnly') === '1' || query.get('dayOnly') === 'true')) return true;
  if (query && (query.get('dayOnly') === '0' || query.get('dayOnly') === 'false')) return false;
  return DAY_ONLY_BACKFILL_DEFAULT;
}
