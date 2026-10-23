/**
 * 本站的 Worker 入口。
 *
 * 原来这是一个 Cloudflare Pages 项目（functions/ 下每个文件是一个 Pages Function，
 * 路由由目录结构决定）。2026-10 改成 Worker + 静态资源：新的 cf CLI 不支持
 * Legacy Pages（`cf pages deploy` 直接拒绝），而本机 wrangler 的登录态已失效，
 * 再不搬这个站就发不出版本了。
 *
 * 为了不重写 handler，这里放一层很薄的垫片：路由表显式写出（打包器只认静态
 * import，没法像 Pages 那样扫目录），handler 文件原样保留 Pages 的写法 ——
 * 还是导出 onRequest / onRequestGet / onRequestPost，还是收一个带 request / env /
 * params / next / waitUntil 的 context。
 *
 * 这份垫片和 l4d2-map-download-helper 的那份是同一套，改动请两边一起改。
 */

import { onRequest as middleware } from "./_middleware.js";

import * as aiInsight from "./api/ai-insight.js";
import * as feedbackFile from "./api/feedback/file/[key].js";
import * as feedbackUpload from "./api/feedback/upload.js";
import * as fetchApi from "./api/fetch.js";
import * as platformCurrentTrend from "./api/platform-current-trend.js";
import * as sessionStatus from "./api/session-status.js";
import * as tokenCipher from "./api/token-cipher.js";

type Handler = (ctx: PagesContext) => Response | Promise<Response>;
type RouteModule = Record<string, Handler | undefined>;

interface PagesContext {
  // 入站请求（带 cf 字段），和 Pages 给 handler 的那个是同一个类型
  request: Request<unknown, IncomingRequestCfProperties>;
  env: Env;
  /** 动态段，Pages 里叫 params：/api/feedback/file/[key] → { key: "…" } */
  params: Record<string, string>;
  data: Record<string, unknown>;
  /** 命中的路由，Pages 里就是这个值（handler 基本不用，但类型上是 EventContext 的一部分） */
  functionPath: string;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  next(): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  [key: string]: unknown;
}

/**
 * 路由表。`:name` 是动态段，对应原来文件名里的 [name]。
 * 顺序无关：匹配是按段逐一比对的，静态段优先于动态段。
 */
const ROUTES: Array<{ path: string; mod: RouteModule }> = [
  { path: "/api/ai-insight", mod: aiInsight },
  { path: "/api/feedback/file/:key", mod: feedbackFile },
  { path: "/api/feedback/upload", mod: feedbackUpload },
  { path: "/api/fetch", mod: fetchApi },
  { path: "/api/platform-current-trend", mod: platformCurrentTrend },
  { path: "/api/session-status", mod: sessionStatus },
  { path: "/api/token-cipher", mod: tokenCipher },
];

const COMPILED = ROUTES.map((r) => ({ path: r.path, segments: r.path.slice(1).split("/"), mod: r.mod }));

interface Match {
  mod: RouteModule;
  params: Record<string, string>;
  path: string;
}

function match(pathname: string): Match | null {
  const parts = pathname.replace(/\/+$/, "").slice(1).split("/");
  let dynamic: Match | null = null;

  for (const route of COMPILED) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let exact = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i]!;
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(parts[i]!);
        exact = false;
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // 静态路径赢过动态路径：/api/feedback/file/list 该走同名静态路由（如果有），
    // 而不是被 /api/feedback/file/:key 吃掉。
    if (exact) return { mod: route.mod, params, path: route.path };
    dynamic ??= { mod: route.mod, params, path: route.path };
  }
  return dynamic;
}

/** Pages 的约定：onRequest<Method> 优先，没有就退回 onRequest。 */
function pick(mod: RouteModule, method: string): Handler | undefined {
  const named = `onRequest${method.charAt(0)}${method.slice(1).toLowerCase()}`;
  return mod[named] ?? mod.onRequest;
}

export default {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const hit = match(url.pathname);

    const dispatch = async (): Promise<Response> => {
      if (!hit) return env.ASSETS.fetch(request);
      const handler = pick(hit.mod, request.method);
      // 路径命中但方法不对：Pages 在这种情况下回 405
      if (!handler) return new Response("Method Not Allowed", { status: 405 });
      return handler(context);
    };

    const context: PagesContext = {
      request,
      env,
      params: hit?.params ?? {},
      data: {},
      functionPath: hit?.path ?? url.pathname,
      waitUntil: (promise) => ctx.waitUntil(promise),
      passThroughOnException: () => ctx.passThroughOnException(),
      next: dispatch,
    };

    // _middleware 对所有请求生效（包括静态资源），和 Pages 里一样
    return middleware(context);
  },
} satisfies ExportedHandler<Env>;
