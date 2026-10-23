import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// 本站前端是手写的静态文件，没有打包这一步 —— public/ 里的东西原样上线。
//
// 之所以还要 Vite：cf 的 assets 配置里没有「目录」这一项，它只认构建产物里的
// assets 目录，而官方给「无框架静态站」的路子就是这个插件 —— public 目录非空时，
// 它会把 public/ 原样拷成 client 产物，同时把 Worker（src/worker/index.ts，
// 配置在 cloudflare.config.ts）打包好，一起写进 Build Output Specification。
//
// publicDir 里的文件不会被 Vite 处理或改写，所以 index.html 和那几个手写的 js
// 进去什么样、出来还是什么样。
export default defineConfig({
  plugins: [cloudflare()],
});
