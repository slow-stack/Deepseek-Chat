import { request, resolveEndpointFor } from './client.js'
import { modelFor } from './endpoints.js'
import type { ApiCapability } from './capability.js'

/** 对话类没单独配模型时的内置默认值，与 store.ts / compaction.ts 保持一致 */
const CHAT_FALLBACK = 'deepseek-flash'

/**
 * 用最小代价真打一次该能力。
 *
 * 只验地址不行——地址对、密钥错，或者密钥对、模型名写错，都要等真正聊天时才发现。
 * 所以对话与摘要真发一条 1 token 的请求（顺带验模型名），搜索与合成真发一次最小请求，
 * 识别需要音频，只验地址与密钥。
 *
 * 失败一律抛 ApiError，界面按状态码给出人话。
 */
export const probeEndpoint = async (
  capability: ApiCapability,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  const endpoint = resolveEndpointFor(capability, apiKey)
  const key = endpoint.apiKey || apiKey

  if (capability === 'chat' || capability === 'summary') {
    const response = await request(`${endpoint.anthropic}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelFor(capability, CHAT_FALLBACK),
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal,
    })
    // 非流式请求，读掉响应体才释放连接
    await response.text()
    return
  }

  if (capability === 'search') {
    const response = await request(`${endpoint.origin}/v1/tools/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'ping', count: 1 }),
      signal,
    })
    await response.text()
    return
  }

  if (capability === 'tts') {
    const response = await request(`${endpoint.origin}/v1/tools/tts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '测试',
        voice_id: 'stella',
        format: 'pcm',
        filter_markdown: true,
      }),
      signal,
    })
    // 合成返回的是音频流，探测只关心开到没开，读完头就取消
    await response.body?.cancel()
    return
  }

  // 识别没有不传音频的探测方式，只验地址与密钥
  const response = await request(`${endpoint.origin}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal,
  })
  await response.text()
}
