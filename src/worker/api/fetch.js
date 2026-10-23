import {
  readJsonBody,
  resolveDayOnlyBackfill,
  sanitizeRange,
  readTokenConfigSession,
  loadDailyDataRange,
  getMissingDailyDates,
  loadCurrentTrendMapWithStaleFallback,
  loadCurrentTrendMap,
  mergeTodayDailyIntoData,
  refreshDashboardData,
  mergeCurrentTrendsWithFreshFetch,
  summarizeFetchLogs,
  appendErrorLog,
  beijingDateStr,
  DAY_ONLY_BACKFILL_DEFAULT,
  TOKEN_INVALID_MSG,
  json
} from '../_lib/dashboard.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const body = await readJsonBody(request);

  const dayOnly = resolveDayOnlyBackfill(body, url.searchParams);
  const range = sanitizeRange(
    body.startDate || url.searchParams.get('startDate'),
    body.endDate || url.searchParams.get('endDate')
  );
  const tokenState = await readTokenConfigSession(db);
  const dbData = await loadDailyDataRange(db, range.startDate, range.endDate);
  const missing = getMissingDailyDates(range.startDate, range.endDate, dbData);

  if (!tokenState.ok || !tokenState.session) {
    const currentTrends = await loadCurrentTrendMapWithStaleFallback(db, beijingDateStr());
    return json({
      ok: Object.keys(dbData).length > 0,
      tokenInvalid: true,
      tokenExpired: !!tokenState.expired,
      error: TOKEN_INVALID_MSG,
      logs: [],
      data: dbData,
      currentTrends,
      expireTime: tokenState.expireTime || null,
      updateTime: tokenState.updateTime || null,
      message: tokenState.error || TOKEN_INVALID_MSG,
      dayOnly,
      dayOnlyDefault: DAY_ONLY_BACKFILL_DEFAULT,
      fromDatabase: Object.keys(dbData).length > 0,
      localComplete: missing.missingCount === 0
    });
  }

  const token = tokenState.session.token;
  try {
    let allLogs = [];
    let tokenInvalid = false;
    const todayDailyByChart = {};
    const MAX_DAILY_FETCH_PASSES = 2;

    for (let pass = 0; pass < MAX_DAILY_FETCH_PASSES; pass++) {
      let slice = await loadDailyDataRange(db, range.startDate, range.endDate);
      slice = mergeTodayDailyIntoData(slice, todayDailyByChart);
      const miss = getMissingDailyDates(range.startDate, range.endDate, slice);
      if (miss.missingCount === 0) break;
      const refreshed = await refreshDashboardData(db, miss.missingByPlatform, token, range, {
        dayOnly,
        todayDailyByChart
      });
      allLogs = allLogs.concat(refreshed.logs);
      tokenInvalid = refreshed.tokenInvalid;
      if (tokenInvalid) break;
    }

    let data = await loadDailyDataRange(db, range.startDate, range.endDate);
    data = mergeTodayDailyIntoData(data, todayDailyByChart);
    const remainingMissing = getMissingDailyDates(range.startDate, range.endDate, data);

    let currentTrends = {};
    if (!tokenInvalid) {
      const merged = await mergeCurrentTrendsWithFreshFetch(db, token, await loadCurrentTrendMap(db, beijingDateStr()));
      allLogs = allLogs.concat(merged.logs);
      tokenInvalid = tokenInvalid || merged.tokenInvalid;
      currentTrends = merged.trends;
    }

    if (allLogs.length > 0) {
      appendErrorLog({
        type: 'fetch_summary',
        range,
        dayOnly,
        tokenRejected: tokenInvalid,
        tokenExpireTime: tokenState.session.expireTime || null,
        summary: summarizeFetchLogs(allLogs),
        time: new Date().toISOString()
      });
    }

    const fromDatabaseDaily = missing.missingCount === 0;
    let message = '';
    if (fromDatabaseDaily) {
      message = '日榜已全部命中历史库（不含当天）；当日趋势已实时请求云端';
    } else {
      message = tokenInvalid ? TOKEN_INVALID_MSG : '已按日补齐缺失日榜；当日趋势已实时请求云端';
    }
    if (!tokenInvalid && remainingMissing.missingCount > 0) {
      message += `；仍有 ${remainingMissing.missingCount} 个日期×平台缺口未补齐`;
    }

    if (tokenInvalid) {
      return json({
        ok: false,
        tokenInvalid: true,
        tokenExpired: false,
        error: TOKEN_INVALID_MSG,
        logs: allLogs,
        data,
        currentTrends,
        expireTime: tokenState.session.expireTime || null,
        updateTime: tokenState.session.updateTime || null,
        message: TOKEN_INVALID_MSG,
        dayOnly,
        dayOnlyDefault: DAY_ONLY_BACKFILL_DEFAULT,
        fromDatabase: fromDatabaseDaily,
        localComplete: false
      });
    }

    return json({
      ok: true,
      tokenInvalid: false,
      tokenExpired: false,
      error: null,
      logs: allLogs,
      data,
      currentTrends,
      expireTime: tokenState.session.expireTime || null,
      updateTime: tokenState.session.updateTime || null,
      message,
      dayOnly,
      dayOnlyDefault: DAY_ONLY_BACKFILL_DEFAULT,
      fromDatabase: fromDatabaseDaily,
      localComplete: remainingMissing.missingCount === 0
    });
  } catch (e) {
    const errMsg = e.message || '请求异常';
    appendErrorLog({
      type: 'server_exception',
      error: errMsg,
      stack: e.stack || '',
      time: new Date().toISOString(),
      options: { startDate: range.startDate, endDate: range.endDate }
    });
    return json({
      ok: false,
      tokenInvalid: true,
      tokenExpired: false,
      error: TOKEN_INVALID_MSG,
      logs: [],
      data: dbData,
      currentTrends: await loadCurrentTrendMapWithStaleFallback(db, beijingDateStr()),
      expireTime: tokenState.expireTime || null,
      updateTime: tokenState.updateTime || null,
      message: TOKEN_INVALID_MSG,
      dayOnly,
      dayOnlyDefault: DAY_ONLY_BACKFILL_DEFAULT,
      fromDatabase: Object.keys(dbData).length > 0,
      localComplete: false
    });
  }
}
