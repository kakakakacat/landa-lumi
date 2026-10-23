import {
  readJsonBody,
  DEFAULT_AI_DASHSCOPE_KEY,
  DEFAULT_AI_DASHSCOPE_BASE,
  DEFAULT_AI_DASHSCOPE_MODEL,
  json
} from '../_lib/dashboard.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await readJsonBody(request);

  const openaiKey = env.OPENAI_API_KEY;
  const apiKey = openaiKey || env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY || DEFAULT_AI_DASHSCOPE_KEY;
  const rawMessages = body && Array.isArray(body.messages) ? body.messages : [];
  const contextText = body && body.contextText != null ? String(body.contextText).slice(0, 120000) : '';
  const explicitBase = env.OPENAI_BASE_URL || env.DASHSCOPE_BASE_URL;
  const defaultBase = openaiKey ? 'https://api.openai.com/v1' : DEFAULT_AI_DASHSCOPE_BASE;
  const baseUrl = String(explicitBase || defaultBase).replace(/\/$/, '');
  const explicitModel = env.OPENAI_MODEL || env.DASHSCOPE_MODEL;
  const model = explicitModel || (openaiKey ? 'gpt-4o-mini' : DEFAULT_AI_DASHSCOPE_MODEL);

  const sys = `你是熟悉社交媒体数据业务的分析助手。用户会提供「仪表盘」里微博粉丝、抖音个人话题、小红书话题的增量与趋势摘要。请基于摘要做解读，指出趋势、异常、平台间对比，并给出可执行的建议（如关注哪些指标、是否需要拉长观察周期）。
- 不要编造摘要中不存在的数值。
- 若数据不足，请说明还需要什么信息。
- 使用简洁中文段落与列表。

【当前数据摘要】
${contextText || '（无摘要）'}`;

  const messages = [{ role: 'system', content: sys }];
  rawMessages.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').slice(0, 32000);
    if (!content.trim()) return;
    messages.push({ role, content });
  });
  if (messages.length < 2) {
    return json({ ok: false, error: '至少需要一条非空的用户消息' }, 400);
  }
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature: 0.55, max_tokens: 2048 })
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return json({ ok: false, error: '模型响应非 JSON', detail: text.slice(0, 500) }, 502);
    }
    if (!r.ok) {
      const errMsg =
        data.error && data.error.message
          ? data.error.message
          : typeof data.message === 'string'
            ? data.message
            : text.slice(0, 400);
      return json({ ok: false, error: errMsg }, 502);
    }
    const reply =
      data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        ? String(data.choices[0].message.content)
        : '';
    return json({ ok: true, reply });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}
