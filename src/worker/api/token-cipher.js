import {
  validateIncomingCipher,
  verifyRemoteTokenUsage,
  saveTokenCipher,
  resetRemoteVerifyCache,
  readJsonBody,
  json
} from '../_lib/dashboard.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const secret = env.TOKEN_UPDATE_SECRET;
  if (secret && String(request.headers.get('x-token-update-secret') || '') !== secret) {
    return json({ ok: false, error: '未授权更新 token' }, 403);
  }

  const body = await readJsonBody(request);
  const raw = body && body.cipher != null ? String(body.cipher) : '';
  let validated;
  try {
    validated = validateIncomingCipher(raw);
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) });
  }
  try {
    const remote = await verifyRemoteTokenUsage(validated.token, { force: true });
    if (!remote.remoteValid) {
      return json({ ok: false, error: remote.remoteMsg || '云端验证未通过，未写入配置' });
    }
  } catch (e) {
    return json({ ok: false, error: e.message || '云端验证异常' });
  }

  try {
    await saveTokenCipher(db, validated.cipher);
  } catch (e) {
    return json({ ok: false, error: `写入 token 密文失败: ${e.message}` });
  }
  resetRemoteVerifyCache();

  return json({
    ok: true,
    expireTime: validated.expireTime != null ? validated.expireTime : null,
    updateTime: validated.updateTime != null ? validated.updateTime : null,
    storage: 'd1'
  });
}
