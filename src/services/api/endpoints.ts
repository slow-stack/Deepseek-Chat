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