/**
 * 把旧入口 301 到正式域名 landa.kakacat.net。
 *
 * 历史：本站原来挂在 landa.kakacat.icu（该域名已失效、没有 NS 记录，打不开了），
 * 2026-10 主域名迁到 landa.kakacat.net。名单里只剩 Pages 项目自带的 .pages.dev ——
 * Pages 无法删掉这个地址，只能用重定向让它作废，避免同一份站点存在两个入口
 * （分裂的书签、外链、SEO）。
 *
 * 2026-10 本站从 Pages 改成 Worker 之后，.pages.dev 随 Pages 项目一起退场，这条
 * 跳转留着是为了旧链接还能落地（Pages 项目删掉前它仍然解析得到）。
 * 只跳生产主机名，带哈希的预览地址（如 9372bb4e.landa-lumi.pages.dev）保持原样。
 */
const CANONICAL = "landa.kakacat.net";
const LEGACY_HOSTS = new Set(["landa-lumi.pages.dev"]);

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (LEGACY_HOSTS.has(url.hostname)) {
    url.hostname = CANONICAL;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
};
