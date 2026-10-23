import { readTokenConfigSession, verifyRemoteTokenUsage, json } from '../_lib/dashboard.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

  const tokenState = await readTokenConfigSession(db);
  if (!tokenState.ok) {
    return json({
      ok: false,
      error: tokenState.error,
      hasActiveToken: false,
      expireTime: null,
      updateTime: null,
      remoteValid: null,
      remoteError: null
    });
  }
  if (tokenState.expired) {
    return json({
      ok: true,
      hasActiveToken: false,
      expired: true,
      expireTime: tokenState.expireTime || null,
      updateTime: tokenState.updateTime || null,
      error: tokenState.error || null,
      remoteValid: null,
      remoteError: null
    });
  }
  let remoteValid = null;
  let remoteError = null;
  if (tokenState.session && tokenState.session.token) {
    try {
      const r = await verifyRemoteTokenUsage(tokenState.session.token, { force: forceRefresh });
      remoteValid = r.remoteValid;
      remoteError = r.remoteMsg;
    } catch (e) {
      remoteValid = null;
      remoteError = e.message || '验证异常';
    }
  }
  return json({
    ok: true,
    hasActiveToken: !!tokenState.session,
    expired: false,
    expireTime: tokenState.expireTime || null,
    updateTime: tokenState.updateTime || null,
    error: null,
    remoteValid,
    remoteError
  });
}
