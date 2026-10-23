# Landa Lumi（兰达流光）

> 你发光的每一刻都值得记录

应援数据看板：把微博粉丝数、抖音个人话题、小红书话题的日榜和当日趋势聚到一页，
历史数据落在 D1 里，缺口按日回补。线上地址 <https://landa.kakacat.net>。

## 结构

```
public/            手写的静态前端（没有打包步骤，原样上线）
src/worker/        Worker
  index.ts         入口：Pages 风格 handler 的路由垫片
  _middleware.js   旧入口 301 到正式域名
  api/             各接口，仍是 Pages Functions 的写法
  _lib/dashboard.js  取数、解密、落库、合并的全部逻辑
d1/schema.sql      D1 表结构
```

接口：`/api/fetch`（日榜，缺口回补）、`/api/platform-current-trend`（当日趋势）、
`/api/session-status`（token 状态）、`/api/token-cipher`（写入新的 token 密文）、
`/api/ai-insight`（对着数据摘要问模型）、`/api/feedback/upload` 与
`/api/feedback/file/:key`（反馈组件的附件，存 R2）。

## 本地开发与部署

```bash
npm install
npx vite            # 本地跑（Worker + 静态资源，D1 用本地模拟，是空库）
npm run deploy      # typecheck + vite build + cf deploy
```

部署用新的 `cf` CLI，配置在 `cloudflare.config.ts`。两点要记住：

- **`cf deploy` 会把 secret 重置成空占位**，所以顺序是先部署、再
  `cf workers secrets update <名字> --script-name landa-lumi --type secret_text --text "<值>"`。
- **新建 Worker 的第一次部署**没法先建后设，要 `cf deploy --secrets-file <文件>`，
  文件里一行一个 `NAME=值`。

secret 只有两个：`DASHSCOPE_API_KEY`（`/api/ai-insight` 调百炼用）、
`TOKEN_UPDATE_SECRET`（写入 token 密文的口令，留空 = 不校验）。

## 历史

本站原来是 Cloudflare Pages 项目（`functions/` 按目录定路由）。2026-10 改成
Worker + 静态资源：新的 cf CLI 不支持 Legacy Pages，再不搬就发不出版本了。
handler 一行没改，`src/worker/index.ts` 那层垫片替 Pages 做了扫目录定路由的事。
