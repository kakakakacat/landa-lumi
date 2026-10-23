// cf CLI 的工程配置。本站原来是 Cloudflare Pages 项目（wrangler.toml +
// pages_build_output_dir = "public"），2026-10 改成 Worker + 静态资源：
// 新的 cf CLI 不支持 Legacy Pages，而 wrangler 的登录态已失效，站点因此发不出版本。
// 路由不再由目录结构决定，改由 src/worker/index.ts 里的路由表显式写出。
//
// 密钥不在这里，用 `cf workers secrets update <名字> --script-name landa-lumi
// --type secret_text --text "<值>"` 逐个设，**并且只能在 `cf deploy` 之后设** ——
// 部署会按下面的 bindings.secret() 声明重建绑定，把已有的值重置成空占位：
//   DASHSCOPE_API_KEY     /api/ai-insight 调百炼用的 key（原 Pages 项目上就有）
//   TOKEN_UPDATE_SECRET   /api/token-cipher 更新 token 的口令；留空 = 不校验（当前就是空的）
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "cc05c4c38d992a07dce258cd8ee5e32a",
  worker: {
    name: "landa-lumi",
    compatibilityDate: "2024-11-06",
    // lib/dashboard.js 用 sm-crypto 解 token 密文
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/worker/index.ts",
    // 站点对外的唯一入口。从 Pages 项目手上接过来：先在 Pages 那边解绑这个自定义域、
    // 再删掉它留下的 CNAME（Pages 解绑后记录不会自动消失，留着的话 Worker 建不了
    // 自定义域），然后才 `cf deploy`。
    domains: ["landa.kakacat.net"],
    assets: {
      // 这个站不是 SPA：找不到就是 404，别把 index.html 当兜底塞回去
      notFoundHandling: "none",
      // /api/* 一律先给 Worker，别被静态资源抢走。裸路径要单列：
      // "/api/*" 匹配不到 "/api" 本身。
      runWorkerFirst: ["/api", "/api/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // 日榜 / 当日趋势 / token 密文（d1/schema.sql）
      DB: bindings.d1({
        name: "landa-fan-support-db",
        id: "32417f8f-c78e-49fd-8aaf-a946fedca016",
      }),
      // 反馈组件的附件，和其他站共用一个桶
      FEEDBACK_BUCKET: bindings.r2({ name: "feedback-uploads" }),

      DASHSCOPE_API_KEY: bindings.secret(),
      TOKEN_UPDATE_SECRET: bindings.secret(),
    },
  },
});
