/**
 * GET /api/feedback/file/:key — stream an uploaded attachment back from R2,
 * preserving its original filename. Keys are random UUIDs (unguessable).
 */
export async function onRequestGet(context) {
  const { params, env } = context;
  const bucket = env.FEEDBACK_BUCKET;
  if (!bucket) return new Response("R2 bucket 未绑定", { status: 500 });

  const obj = await bucket.get(params.key);
  if (!obj) return new Response("文件不存在或已被清理", { status: 404 });

  const name = (obj.customMetadata && obj.customMetadata.name) || params.key;
  const headers = new Headers();
  headers.set("Content-Type", (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (obj.size != null) headers.set("Content-Length", String(obj.size));
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { headers });
}
