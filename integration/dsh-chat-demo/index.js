/**
 * dsh-chat-demo —— Host 半边
 *
 * 它做两件事：
 * 1. 把 chat-demo 的静态产物（dist/）挂在一个固定端口上；
 * 2. 把「服务在不在、端口多少、为什么不在」通过 /api/dsh-chat-demo/status 告诉客户端面板。
 *
 * 为什么要独立端口而不是宿主路由：chat-demo 的会话与附件存在浏览器 IndexedDB 里，
 * 按 origin 隔离；http://127.0.0.1:<port> 是一个真实、稳定的 origin，重启 DSH 也还在。
 * 端口因此是配置项而不是随机值。
 *
 * 为什么写 diag.log：apply 被整段 try/catch 兜住（挂不上不该拖累宿主启动），
 * 出问题时宿主日志里往往什么都没有，于是这里自己留痕。
 *
 * 记忆面：这个插件完全不 import mneme，也不往会话日志写任何东西。聊什么都不会入库。
 */

import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(PACKAGE_DIR, "dist");
const DIAG_DIR = "D:/DSH/.dsh/dsh-chat-demo";
const DIAG_FILE = join(DIAG_DIR, "diag.log");

/** 一行一条，带时间戳；写失败也不能影响主流程。 */
function diag(line) {
  try {
    mkdirSync(DIAG_DIR, { recursive: true });
    appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* 留痕失败就算了 */
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(String(urlPath || "/").split("?")[0].split("#")[0]);
  const candidate = normalize(join(DIST_DIR, clean));
  if (!candidate.startsWith(DIST_DIR)) return null; // 目录穿越
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const index = join(candidate, "index.html");
      if ((await stat(index)).isFile()) return index;
    }
  } catch {
    /* 交给单页兜底 */
  }
  return null;
}

function serveDist(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  resolveFile(req.url)
    .then((file) => file || join(DIST_DIR, "index.html"))
    .then(async (file) => {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
        "content-length": body.length,
      });
      if (req.method === "HEAD") res.end();
      else res.end(body);
    })
    .catch((error) => {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`读取 chat-demo 静态文件失败：${error?.message ?? error}`);
    });
}

/** 端口被占时，先确认占着的是不是我们自己那台（换 DSH 版本后热重载会撞上）。 */
async function probeExisting(host, port) {
  try {
    const res = await fetch(`http://${host}:${port}/`, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export const inject = ["webServer"];

export function apply(ctx, config = {}) {
  // 这个插件挂不上不该拖累宿主启动：整段兜住，出错只留痕。面板那边会显示服务不可用。
  try {
    return applyInner(ctx, config);
  } catch (error) {
    void diag(`apply 抛错：${error?.stack ?? error}`);
    try {
      ctx.logger?.warn?.(`[dsh-chat-demo] 初始化失败：${error?.message ?? error}`);
    } catch {
      /* 连 logger 都没有就算了 */
    }
  }
}

function applyInner(ctx, config = {}) {
  const host = String(config.host || "127.0.0.1");
  const port = Number(config.port || 8096);
  const state = { host, port, started: false, reused: false, error: null, attempts: 0 };

  void diag(`apply 开始 port=${port} host=${host} 进程=${process.pid}`);

  const disposers = [];
  const disposeAll = () => {
    void diag(`dispose 开始 进程=${process.pid} stack=${String(new Error().stack).split("\n").slice(1, 4).join(" <- ")}`);
    while (disposers.length) {
      const dispose = disposers.pop();
      try {
        dispose?.();
      } catch {
        /* 卸载时不让清理异常冒出去 */
      }
    }
  };

  // 宿主 HTTP 面：只报状态，面板据此显示「服务没起来」而不是一片空白 iframe。
  const webServer = ctx.get?.("webServer") ?? ctx.webServer;
  void diag(`webServer=${webServer ? "有" : "无"} register=${typeof webServer?.register}`);
  if (webServer?.register) {
    try {
      disposers.push(
        webServer.register({
          kind: "exact",
          path: "/api/dsh-chat-demo/status",
          handler: (req, res) => {
            const body = JSON.stringify({
              ok: !state.error,
              url: `http://${state.host}:${state.port}/`,
              port: state.port,
              started: state.started,
              reused: state.reused,
              attempts: state.attempts,
              error: state.error,
            });
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(body);
          },
        }),
      );
      void diag("status 路由已注册");
    } catch (error) {
      void diag(`status 路由注册失败：${error?.message ?? error}`);
    }
  }

  const server = createServer(serveDist);
  let retryTimer = null;
  server.on("error", async (error) => {
    state.attempts += 1;
    await diag(`listen 错误（第 ${state.attempts} 次）code=${error?.code} ${error?.message ?? error}`);
    if (error?.code === "EADDRINUSE" && (await probeExisting(host, port))) {
      // 端口上已经有一台能应答的 chat-demo（热重载/旧进程残留）：直接接管，不重复监听。
      state.reused = true;
      state.started = false;
      await diag("端口已有可用实例，标记 reused");
      return;
    }
    state.error = String(error?.message ?? error);
    // 旧进程正在退出时端口会短暂占用：等一会儿再试，最多 5 次。
    if (error?.code === "EADDRINUSE" && state.attempts <= 5) {
      retryTimer = setTimeout(() => listenAgain(), 2000);
      return;
    }
    void diag(`放弃监听：${state.error}`);
    try {
      ctx.logger?.warn?.(`[dsh-chat-demo] 静态服务起不来：${state.error}`);
    } catch {
      /* 忽略 */
    }
  });
  const listenAgain = () => {
    try {
      server.listen(port, host);
    } catch (error) {
      state.error = String(error?.message ?? error);
      void diag(`再次 listen 同步失败：${state.error}`);
    }
  };
  server.on("close", () => {
    void diag(`server 已关闭 进程=${process.pid}`);
  });
  void diag(`listen 调用 port=${port} host=${host}`);
  server.listen(port, host, () => {
    state.started = true;
    state.error = null;
    void diag(`已在 http://${host}:${port}/ 监听`);
    try {
      ctx.logger?.info?.(`[dsh-chat-demo] chat-demo 已挂在 http://${host}:${port}/`);
    } catch {
      /* 忽略 */
    }
  });
  disposers.push(() => {
    if (retryTimer) clearTimeout(retryTimer);
    server.close();
  });

  void diag(`apply 返回 disposers=${disposers.length}`);
  // ctx.effect 的入参是「effect 本体」，它会被立刻执行、返回值才被收集成 dispose。
  // 之前直接传 disposeAll 等于挂载完立刻自毁：路由被撤、server.close() 发生在 bind 完成前，
  // 所以端口永远不监听、status 路由永远 404，而 fiber 依旧 active、日志里一个错都没有。
  ctx.effect?.(() => disposeAll);
  ctx.on?.("dispose", disposeAll);
}
