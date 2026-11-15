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
 * 记忆面：插件本身不 import mneme 的代码，只在面板主动调用
 * POST /api/dsh-chat-demo/memory 时代转一条 mneme standalone API 请求
 * （token 从记忆库的 user_settings 只读取，绝不发往页面）。
 * 会话级开关在页面侧（会话上的 memoryEnabled），关掉的会话不会走到这条路由。
 */

import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(PACKAGE_DIR, "dist");
const DIAG_DIR = "D:/DSH/.dsh/dsh-chat-demo";
const DIAG_FILE = join(DIAG_DIR, "diag.log");

/** mneme 的记忆库与 standalone API 位置（token 也从这里取，见 readExternalApi）。 */
const MEMORY_DB = "D:/DSH/.dsh/memory/memory.db";
const MEMORY_ROUTE = "/api/dsh-chat-demo/memory";
/** 读记忆：带 q 走检索、不带 q 走分页列表，结果原样透传 */
const MEMORY_READ_ROUTE = "/api/dsh-chat-demo/memories";
/**
 * 对话入库的作用域，写死不给前端拼。
 * 理由：POST /memories 的 workspace_scope 只校验「非空字符串」，不校验形状
 * （api-standalone.js 的校验段），写错路径不会报错，只会静默落一条谁也不归属的记忆。
 */
const MEMORY_SCOPE = "D:\\DSH\\workspaces\\deepseek-app";

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

/* ---------------------------------------------------------------- 记忆通道 */

/**
 * mneme 的 standalone API 配置（host / port / token）存在记忆库的 user_settings。
 * 只读打开、进程内缓存：这张表由 mneme 自己维护，这里绝不写。
 * token 不进返回值以外的地方——不打印、不回前端、不写 diag。
 */
let externalApi = null;

function readExternalApi() {
  if (externalApi) {
    return externalApi;
  }
  const db = new DatabaseSync(MEMORY_DB, { readOnly: true });
  try {
    const row = db.prepare("select value from user_settings where key = 'external_api'").get();
    if (!row?.value) {
      throw new Error("user_settings 里没有 external_api");
    }
    const parsed = JSON.parse(String(row.value));
    if (parsed?.enabled !== true) {
      throw new Error("external_api 未启用");
    }
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (!token) {
      throw new Error("external_api 缺少 token");
    }
    const host = String(parsed.host || "127.0.0.1");
    const port = Number(parsed.port || 8790);
    externalApi = { host, port, token, base: `http://${host}:${port}` };
    return externalApi;
  } finally {
    db.close();
  }
}

/** 鉴权失败等情况下丢掉缓存，下次调用重读（用户可能刚在设置页换了 token）。 */
function forgetExternalApi() {
  externalApi = null;
}

/**
 * 标题 → mneme 记忆 id。同一轮被续写或重新生成时（标题不变、正文变长）
 * 用它判断该新建还是原地更新；进程内即可，重启后最多多建一行。
 */
const memoryIds = new Map();

const MAX_MEMORY_BODY = 1024 * 1024;

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

const reply = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

/**
 * POST /api/dsh-chat-demo/memory —— 把一段对话原文写进 mneme。
 *
 * 只接受本面板（同源 iframe）调用；body 由客户端组装，这里只做形状收口：
 * type 固定 history（document 会被 mneme 400 拒），workspace_scope 写死。
 * title 参与 mneme 的去重，必须唯一——由客户端按 chat:<sessionId>:<replyId> 生成。
 * 别往 title 里塞 Date.now()：13 位 epoch 毫秒有约 1/10 能通过 Luhn，
 * 会被写入准入当成银行卡号拒掉（422 reason:"sensitive"）。时间放 content 与 occurred_at。
 */
async function handleMemoryWrite(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  let body;
  try {
    body = await readJsonBody(req, MAX_MEMORY_BODY);
  } catch (error) {
    const reason = String(error?.message ?? error);
    void diag(`memory 拒绝：${reason}`);
    reply(res, reason === "body-too-large" ? 413 : 400, { error: reason });
    return;
  }
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!title || !content.trim()) {
    reply(res, 400, { error: "missing-title-or-content" });
    return;
  }

  let config;
  try {
    config = readExternalApi();
  } catch (error) {
    // 读不到就明说读不到，别静默当成功：面板那边会把这条标成「未入库」。
    void diag(`memory 读 external_api 失败：${error?.message ?? error}`);
    reply(res, 503, { error: "memory-api-unavailable", message: String(error?.message ?? error) });
    return;
  }

  const payload = {
    type: "history",
    title,
    content,
    workspace_scope: MEMORY_SCOPE,
    occurred_at: typeof body.occurred_at === "string" && body.occurred_at ? body.occurred_at : new Date().toISOString(),
  };

  // 同一轮被续写/重生成时会再写一次，标题相同、正文更长。mneme 的 POST 只在
  // 「标题+正文都相同」时并入同一行，正文变了会另起一行 —— 所以我们自己记住
  // 标题对应的 id，第二次起改走 PUT 原地更新，避免一条对话散成几行。
  // （PUT 只收 title/content/type/importance/tags/scope，occurred_at 不在其列。）
  let targetId = memoryIds.get(title);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const upstream = targetId
        ? await fetch(`${config.base}/memories/${encodeURIComponent(targetId)}`, {
            method: "PUT",
            headers: {
              authorization: `Bearer ${config.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ content }),
          })
        : await fetch(`${config.base}/memories`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });
      if (upstream.status === 401 && attempt === 0) {
        forgetExternalApi();
        config = readExternalApi();
        continue;
      }
      if (upstream.status === 404 && targetId) {
        // 那一行被删了（或换了记忆库）：忘掉 id，这次退回 POST 新建。
        memoryIds.delete(title);
        targetId = undefined;
        continue;
      }
      const text = await upstream.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 200) };
      }
      // PUT 的返回是 { memory: {...} }，POST 的是记忆本身 + action；统一成后者。
      const saved = parsed?.memory ?? parsed;
      if (typeof saved?.id === "string" && saved.id) {
        memoryIds.set(title, saved.id);
      }
      const action = parsed?.action ?? (targetId ? "updated" : "saved");
      // 201/200 建或并、422 内容被准入判据拒 —— 都是 mneme 的明确答复，原样透传。
      void diag(`memory ${targetId ? "更新" : "写入"} status=${upstream.status} action=${action}`);
      reply(res, upstream.status, { ...saved, action });
      return;
    } catch (error) {
      if (attempt === 0) {
        continue;
      }
      void diag(`memory 转发失败：${error?.message ?? error}`);
      reply(res, 502, { error: "memory-api-unreachable", message: String(error?.message ?? error) });
      return;
    }
  }
}

const replyRaw = (res, status, text) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
};

/**
 * GET /api/dsh-chat-demo/memories —— 读记忆。
 *
 * 带 q 走 mneme 的 /search（关键词 + 语义混合，失败时上游自己降级），
 * 不带 q 走 /memories 分页列表。token 只在这个进程里出现，不回前端。
 */
async function handleMemoryRead(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { allow: "GET" });
    res.end();
    return;
  }
  const url = new URL(String(req.url || "/"), "http://127.0.0.1");
  const query = (url.searchParams.get("q") || "").trim();
  const limitRaw = Number(url.searchParams.get("limit") || 20);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 100);
  const offsetRaw = Number(url.searchParams.get("offset") || 0);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);
  const path = query
    ? `/search?q=${encodeURIComponent(query)}&topK=${limit}`
    : `/memories?limit=${limit}&offset=${offset}&order=desc`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let api;
    try {
      api = readExternalApi();
    } catch (error) {
      reply(res, 503, { error: "memory-api-unavailable", message: String(error?.message ?? error) });
      return;
    }
    try {
      const upstream = await fetch(`${api.base}${path}`, {
        headers: { authorization: `Bearer ${api.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if ((upstream.status === 401 || upstream.status === 403) && attempt === 0) {
        // 用户可能刚在设置页换了 token，重读一次再试
        forgetExternalApi();
        continue;
      }
      replyRaw(res, upstream.status, await upstream.text());
      return;
    } catch (error) {
      if (attempt === 0) {
        forgetExternalApi();
        continue;
      }
      void diag(`记忆读取失败：${error?.message ?? error}`);
      reply(res, 502, { error: "memory-api-unreachable", message: String(error?.message ?? error) });
      return;
    }
  }
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

  const server = createServer((req, res) => {
    // 面板自己（8096 同源）发起的记忆写入；静态产物走 GET/HEAD，互不干扰。
    if (String(req.url || "").split("?")[0] === MEMORY_ROUTE) {
      void handleMemoryWrite(req, res);
      return;
    }
    // 记忆面板的读取面；同样只在同源 iframe 里用得上
    if (String(req.url || "").split("?")[0] === MEMORY_READ_ROUTE) {
      void handleMemoryRead(req, res);
      return;
    }
    serveDist(req, res);
  });
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
