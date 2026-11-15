import { API_ORIGIN, setEndpointResolver } from './client.js'
import { useSettings } from '../settings.js'
import type { ApiCapability } from './capability.js'

/**
 * 把设置里的分能力接口装进 API 层。
 *
 * 只在一处读 localStorage 状态，其余调用方不用关心自己该用哪把密钥。
 * 留空的字段一律回落到主接口与全局 API Key，所以没配过的人行为完全不变。
 */
export const installEndpointResolver = () => {
  setEndpointResolver((capability: ApiCapability) => {
    const override = useSettings.getState().endpoints[capability]
    return {
      origin: override.baseUrl || API_ORIGIN,
      apiKey: override.apiKey || null,
    }
  })
}

/** 某条能力该用的模型；没单独配就用内置默认 */
export const modelFor = (capability: ApiCapability, fallback: string): string => {
  const model = useSettings.getState().endpoints[capability].model
  return model || fallback
}

/**
 * 这条能力有没有自己的接口。
 *
 * 联网搜索靠它分流：配了就走客户端直连，留空仍然交给服务端在对话请求里执行。
 */
export const hasOwnEndpoint = (capability: ApiCapability): boolean => {
  const override = useSettings.getState().endpoints[capability]
  return Boolean(override.baseUrl || override.apiKey)
}

/** 联网搜索是否由客户端自己执行 */
export const searchEndpointConfigured = (): boolean => hasOwnEndpoint('search')