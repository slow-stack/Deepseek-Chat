import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { classifyApiError } from '../../services/api/errors.js'
import { fetchBalance, type AccountBalance } from '../../services/api/balance.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/** 桌面端用浏览器新标签，旁装 App 的 WebView 里只有 _system 交给系统浏览器 */
const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

/**
 * 查一次余额；没有 Key 时不发请求。
 *
 * 金额是服务端给的字符串，直接照抄，不在前端做汇率或四舍五入，
 * 显示口径跟着账户页走。换 Key 后旧余额就不算数了，先清空再查。
 */
const useBalance = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [balance, setBalance] = useState<AccountBalance | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!apiKey) {
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      setBalance(await fetchBalance(apiKey))
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }, [apiKey])

  // 打开数据管理就先查一次，别让人对着「读取中」还得自己点刷新
  useEffect(() => {
    setBalance(null)
    setFailure(null)
    void load()
  }, [load])

  return { apiKey, balance, busy, failure, load }
}

/**
 * 账户余额：一行金额 + 「刷新」与「前往充值」。
 *
 * 余额不足是最常见的断流原因，摊在数据管理里比等聊天报 402 更早看到。
 * 没有 Key 时不显示这一行——还没开始用，谈不上余额。
 */
export const BalanceSetting = () => {
  const t = useTranslate()
  const { apiKey, balance, busy, failure, load } = useBalance()

  if (!apiKey) {
    return null
  }

  const info = balance?.balances[0]
  const empty = balance !== null && (balance.available === false || Number(info?.total ?? 0) <= 0)
  const description = balance
    ? info
      ? empty
        ? `${info.total} ${info.currency} · ${t('balanceEmptyHint')}`
        : `${info.total} ${info.currency}`
      : t('balanceEmpty')
    : failure
      ? classifyApiError(failure) === 'network'
        ? t('commonNetworkErrorToast')
        : t('balanceFailed')
      : t('balanceLoading')

  return (
    <div className={styles.cell}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('balanceTitle')}</div>
          <div className={clsx(styles.description, empty && styles.error)}>{description}</div>
        </div>
        <div className={styles.balanceActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={busy}
            onClick={() => void load()}
          >
            {t('balanceRefresh')}
          </Button>
          <a className={styles.aboutLink} href={TOP_UP_URL} target="_system" rel="noreferrer">
            {t('topUp')}
          </a>
        </div>
      </div>
    </div>
  )
}
