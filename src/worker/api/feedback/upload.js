/**
 * POST /api/feedback/upload — store attachment files in R2, return links.
 *
 * Part of the reusable feedback widget. Binding required: R2 bucket
 * `FEEDBACK_BUCKET`. Optional env `FEEDBACK_CAP_BYTES` (default ~9.5 GB, to
 * stay within the R2 free 10 GB). When the bucket would exceed the cap, the
 * oldest objects are evicted (by upload time) until the new files fit.
 */
const DEFAULT_CAP = 9.5 * 1024 * 1024 * 1024; // total bucket cap (free tier is 10 GB)
const MB = 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const bucket = env.FEEDBACK_BUCKET;
  if (!bucket) return json({ error: "R2 bucket 未绑定 (FEEDBACK_BUCKET)" }, 500);

  const cap = Number(env.FEEDBACK_CAP_BYTES || DEFAULT_CAP);
  // Per-request abuse limits (override via env).
  const maxFiles = Number(env.FEEDBACK_MAX_FILES || 6);
  const maxFileBytes = Number(env.FEEDBACK_MAX_FILE_BYTES || 25 * MB);
  const maxReqBytes = Number(env.FEEDBACK_MAX_REQUEST_BYTES || 50 * MB);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid form data" }, 400);
  }

  // Optional Cloudflare Turnstile check — enforced only when the secret is set.
  const tsSecret = env.TURNSTILE_SECRET;
  if (tsSecret) {
    const token = form.get("cf-turnstile-response");
    if (!token) return json({ error: "需要人机验证" }, 403);
    try {
      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: tsSecret,
          response: String(token),
          remoteip: request.headers.get("CF-Connecting-IP") || "",
        }),
      });
      const vj = await vr.json();
      if (!vj.success) return json({ error: "人机验证失败，请重试" }, 403);
    } catch {
      return json({ error: "人机验证服务不可用" }, 503);
    }
  }

  const files = form.getAll("files").filter((f) => f && typeof f.arrayBuffer === "function");
  if (!files.length) return json({ error: "no files" }, 400);
  if (files.length > maxFiles) return json({ error: `一次最多 ${maxFiles} 个文件` }, 400);
  for (const f of files) {
    if ((f.size || 0) > maxFileBytes) {
      return json({ error: `单个文件不能超过 ${Math.round(maxFileBytes / MB)}MB` }, 413);
    }
  }

  const incoming = files.reduce((s, f) => s + (f.size || 0), 0);
  if (incoming > maxReqBytes) return json({ error: `单次上传总大小不能超过 ${Math.round(maxReqBytes / MB)}MB` }, 413);
  if (incoming > cap) return json({ error: "文件总大小超过容量上限" }, 413);

  try {
    await evictUntilRoom(bucket, cap, incoming);
  } catch (e) {
    // Eviction failure shouldn't block a small upload; continue and let put fail if truly full.
  }

  const origin = new URL(request.url).origin;
  const out = [];
  for (const f of files) {
    const key = crypto.randomUUID();
    await bucket.put(key, f.stream(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
      customMetadata: { name: f.name || key, uploaded: String(Date.now()) },
    });
    out.push({
      name: f.name || key,
      size: f.size || 0,
      url: `${origin}/api/feedback/file/${key}`,
    });
  }

  return json({ files: out });
}

/** Delete oldest objects (by upload time) until `incoming` bytes will fit under `cap`. */
async function evictUntilRoom(bucket, cap, incoming) {
  const objs = [];
  let cursor;
  do {
    const list = await bucket.list({ cursor, limit: 1000 });
    for (const o of list.objects) {
      objs.push({ key: o.key, size: o.size || 0, t: o.uploaded ? new Date(o.uploaded).getTime() : 0 });
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  let total = objs.reduce((s, o) => s + o.size, 0);
  if (total + incoming <= cap) return;

  objs.sort((a, b) => a.t - b.t); // oldest first
  for (const o of objs) {
    if (total + incoming <= cap) break;
    await bucket.delete(o.key);
    total -= o.size;
  }
}
