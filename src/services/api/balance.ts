import { request, resolveEndpointFor } from './client.js'

/** 余额里的一个币种账户；金额是字符串，服务端保留两位小数 */
export type BalanceInfo = {
  currency: string
  /** 可用总额 = 赠送 + 充值 */
  total: string
  /** 赠送额度 */
  granted: string
  /** 自己充的钱 */
  toppedUp: string
}

export type AccountBalance = {
  /** 账户是否还在可用状态：余额为 0 或欠费时为 false */
  available: boolean
  balances: BalanceInfo[]
}

type RawBalance = {
  is_available?: unknown
  balance_infos?: unknown
}

const readAmount = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * 查账户余额（GET /user/balance，不产生费用）。
 *
 * 地址跟对话能力走同一条解析：自己配了接口的人查的是自己那台的余额，
 * 没配过的就是默认接口。失败照常抛 ApiError，界面按状态码说人话。
 */
export const fetchBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<AccountBalance> => {
  const { origin, apiKey: key } = resolveEndpointFor('chat', apiKey)
  const response = await request(`${origin}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal,
  })
  const body = (await response.json()) as RawBalance
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  return {
    available: body.is_available !== false,
    balances: infos.map((info) => {
      const item = (info ?? {}) as Record<string, unknown>
      return {
        currency: typeof item.currency === 'string' ? item.currency : 'CNY',
        total: readAmount(item.total_balance),
        granted: readAmount(item.granted_balance),
        toppedUp: readAmount(item.topped_up_balance),
      }
    }),
  }
}
