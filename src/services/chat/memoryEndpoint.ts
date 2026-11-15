/**
 * 记忆服务地址的可用性判断。
 *
 * 背景：App 打包后页面是 https（Capacitor 的 androidScheme），而 targetSdk 36 默认禁止明文 http，
 * 我们也没有再挂 network security config。于是用户在设置里填一个 `http://192.168.0.101:8790`，
 * 请求会被设备直接拦掉，在 JS 里只表现成一句 `TypeError: Failed to fetch`——
 * 和「服务没起」「地址写错」长得一模一样，用户只会以为是服务坏了。所以得自己把两种情况分开说。
 *
 * 判据取最宽的一档：https 页面 + http 地址就按「明文被拦」说。
 * 不去猜哪些主机被系统放行——猜错方向反而误导；用户真要用 http，
 * 换个 https 地址是唯一稳妥的答案。
 */

/**
 * 这个地址会不会被当前环境拦下。
 *
 * 判定依据是「页面自己是不是 https」：https 页面去取 http 资源属于混合内容，必然被拦。
 * 页面本身是 http 时（本机 `npm run dev`）不受这层限制。地址解析不出来时不在这里下结论。
 */
export const isCleartextBlocked = (url: string): boolean => {
  if (window.location.protocol !== 'https:') {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'http:'
}

export type MemoryServiceFailure = 'cleartext' | 'unreachable'

/** 带原因的错误：上层据此决定说什么话，而不是笼统一句「连不上」 */
export class MemoryServiceError extends Error {
  readonly reason: MemoryServiceFailure

  constructor(reason: MemoryServiceFailure) {
    super(
      reason === 'cleartext'
        ? 'memory service blocked: cleartext http is not allowed on this device'
        : 'memory service unreachable'
    )
    this.name = 'MemoryServiceError'
    this.reason = reason
  }
}

/** 请求失败后归类：是明文被拦，还是真的连不上 */
export const memoryServiceErrorOf = (url: string): MemoryServiceError =>
  new MemoryServiceError(isCleartextBlocked(url) ? 'cleartext' : 'unreachable')

export const isCleartextFailure = (error: unknown): boolean =>
  error instanceof MemoryServiceError && error.reason === 'cleartext'
