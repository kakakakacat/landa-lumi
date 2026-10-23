import {
  CURRENT_TREND_SOURCE_MAP,
  beijingDateStr,
  loadCurrentTrendMap,
  loadStaleCurrentTrendForPlatform,
  readTokenConfigSession,
  fetchCurrentTrend,
  cloudRequestFailed,
  isValidCurrentTrendPayload,
  buildTokenExpiredLogEntry,
  appendErrorLog,
  TOKEN_INVALID_MSG,
  json
} from '../_lib/dashboard.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const platform = (url.searchParams.get('platform') || '').trim();

  if (!CURRENT_TREND_SOURCE_MAP[platform]) {
    return json({ ok: false, error: '不支持的平台趋势类型', data: null });
  }
  const dayKey = beijingDateStr();
  const cachedMap = await loadCurrentTrendMap(db, dayKey);
  let cached = cachedMap[platform] || null;
  if (!cached) {
    cached = await loadStaleCurrentTrendForPlatform(db, platform);
  }

  const tokenState = await readTokenConfigSession(db);
  if (!tokenState.ok || !tokenState.session) {
    if (cached && isValidCurrentTrendPayload(cached)) {
      return json({
        ok: true,
        stale: true,
        data: cached,
        source: 'database',
        error: tokenState.error || '当前无可用 token，已回退到数据库中的最近趋势数据'
      });
    }
    return json({ ok: false, error: tokenState.error || '当前无可用 token', data: null });
  }
  try {
    const token = tokenState.session.token;
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { result, log } = await fetchCurrentTrend(db, platform, token);
      last = { result, log };
      if (result.code === 401) {
        appendErrorLog(buildTokenExpiredLogEntry(log, { platformKey: platform, phase: 'current_trend' }));
        break;
      }
      if (!cloudRequestFailed(result) && isValidCurrentTrendPayload(result.data)) {
        return json({ ok: true, data: result.data, source: 'remote' });
      }
    }
    const { result } = last || { result: {} };
    if (cached && isValidCurrentTrendPayload(cached)) {
      return json({
        ok: true,
        stale: true,
        data: cached,
        source: 'database',
        error: result.msg || '趋势接口请求失败，已回退到数据库中的最近趋势数据',
        code: result.code,
        status: result.status
      });
    }
    return json({
      ok: false,
      tokenInvalid: true,
      error: TOKEN_INVALID_MSG,
      data: null,
      code: result.code,
      status: result.status
    });
  } catch (e) {
    if (cached && isValidCurrentTrendPayload(cached)) {
      return json({
        ok: true,
        stale: true,
        data: cached,
        source: 'database',
        error: e.message || '平台趋势接口请求失败'
      });
    }
    return json({ ok: false, tokenInvalid: true, error: TOKEN_INVALID_MSG, data: null });
  }
}
