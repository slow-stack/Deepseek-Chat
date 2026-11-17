/*
 * Service Worker：只接管 app shell 的静态资源，绝不碰 API 请求。
 *
 * 为什么这样分：
 * - 页面（HTML）用「先问网络、失败才回缓存」：发新版后只要在线，拿到的就是新 HTML，
 *   它引用的 js/css 文件名带 contenthash，天然不会读到旧文件。
 * - static/ 下的 js、css、字体、图片用「缓存优先」：文件名里有 hash，内容变了名字就变，
 *   不存在把旧代码喂给新页面的问题，也就省掉了每次启动的回源校验。
 * - 其余请求（api.deepseek.com、raw.githubusercontent 的更新清单等）一律不拦、不缓存：
 *   会话和密钥始终只在设备本地，缓存里不出现任何接口响应。
 *
 * 关于老版本退场，这里选的是「skipWaiting + clients.claim + 版本化 cache 清理」：
 * iOS 上从主屏启动的应用是「切后台」而不是「关掉」，靠「等所有页面关闭才换新 SW」
 * 可能几天都换不上；直接接管、并在 activate 时删掉不属于当前版本的 cache，
 * 才能保证下一次打开就是新版本，同时不留下旧文件占空间。
 */

const SHELL_CACHE = 'deepseekchat-shell-v1';
const ASSET_CACHE = 'deepseekchat-assets-v1';
const KEEP_CACHES = [SHELL_CACHE, ASSET_CACHE];

/** 静态资源：文件名带 contenthash，可以长期缓存 */
const isStaticAsset = (url) => url.pathname.includes('/static/');

const isCacheable = (request) => request.method === 'GET' && !request.headers.has('range');

self.addEventListener('install', () => {
  // 不等旧 SW 退出，装好立刻接管
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !KEEP_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/** 页面导航：先网络，失败回 shell；都拿不到就回一段最小离线提示 */
const handleNavigation = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response('<!doctype html><meta charset="utf-8"><title>DeepseekChat</title><p>离线，且还没有缓存到页面。</p>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
};

/** 静态资源：先缓存，没有再去网络取一份存下来 */
const handleAsset = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheable(request)) {
    return;
  }
  const url = new URL(request.url);
  // 只处理本站资源，跨域的接口与统计一律放行
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(handleAsset(request));
  }
});
