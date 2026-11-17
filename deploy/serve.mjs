// 静态服务：把 chat-demo 的 dist 挂在一个固定端口上。
// 固定端口很重要：chat-demo 的会话与附件存在浏览器 IndexedDB，按 origin 隔离，端口一变就等于换了个空库。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const PORT = Number(process.env.PORT || 8096);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = resolve(import.meta.dirname, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

async function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const candidate = normalize(join(ROOT, clean));
  if (!candidate.startsWith(ROOT)) return null; // 目录穿越
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const index = join(candidate, "index.html");
      const indexInfo = await stat(index);
      if (indexInfo.isFile()) return index;
    }
  } catch {
    /* 落到 SPA 兜底 */
  }
  return null;
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  let file = await resolveTarget(req.url || "/");
  // 单页兜底：未知路径回 index.html，交给前端路由
  if (!file) file = join(ROOT, "index.html");
  try {
    const body = await readFile(file);
    // sw.js 必须每次问一次：它自己改名/改内容才是新版退场的触发点，
    // 让它吃 1 小时缓存等于把更新推迟一小时。manifest 同理，改图标后要立刻生效。
    const noCache = /(?:^|[\\/])(index\.html|sw\.js|manifest\.webmanifest)$/.test(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": noCache ? "no-cache" : "public, max-age=3600",
      "content-length": body.length,
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`读取 ${file} 失败：${error?.message ?? error}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`chat-demo 已挂在 http://${HOST}:${PORT}/ （静态根：${ROOT}）`);
});