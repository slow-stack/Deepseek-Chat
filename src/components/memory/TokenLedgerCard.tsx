import { useCallback, useEffect, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  clearUsageEntries,
  countUsageEntries,
  listUsageEntries,
  usageTotals,
  type TokenUsageKind,
  type UsageEntryView,
  type UsageTotals,
} from '../../services/chat/tokenLedger.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './TokenLedgerCard.module.css'

/** 各去向的 i18n key；台账 kind 与文案一一对应 */
const KIND_KEYS: Record<TokenUsageKind, TranslationKey> = {
  digest: 'tokenLedgerKindDigest',
  compaction: 'tokenLedgerKindCompaction',
  profile: 'tokenLedgerKindProfile',
  summary: 'tokenLedgerKindSummary',
}

const KIND_ORDER: TokenUsageKind[] = ['digest', 'compaction', 'profile', 'summary']

const formatCount = (value: number): string => value.toLocaleString()

/**
 * Token 消耗卡：回答「记忆与整理一共花了多少 token、花在哪」。
 *
 * 数据来自本机台账（tokenLedger）：只在真实拿到服务端 usage 时记账，
 * 所以有数的一定是真花的；台账为空说明还没有可计费动作发生。
 * 点开看按去向的分项和最近几笔流水。
 */
export const TokenLedgerCard = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [totals, setTotals] = useState<UsageTotals | null>(null)
  const [entries, setEntries] = useState<UsageEntryView[]>([])
  const [count, setCount] = useState(0)

  const reload = useCallback(async () => {
    try {
      const [nextTotals, nextEntries, nextCount] = await Promise.all([
        usageTotals(),
        listUsageEntries(20),
        countUsageEntries(),
      ])
      setTotals(nextTotals)
      setEntries(nextEntries)
      setCount(nextCount)
    } catch {
      setTotals(null)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void reload()
    }
  }, [open, reload])

  const grand = totals
    ? KIND_ORDER.reduce((sum, kind) => sum + totals[kind], 0)
    : 0

  const clearAll = async () => {
    try {
      await clearUsageEntries()
      await reload()
      showToast({ key: 'tokenLedgerCleared' })
    } catch {
      showToast({ key: 'tokenLedgerClearFailed', type: 'error' })
    }
  }

  return (
    <>
      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={() => setOpen(true)}>
          <span className={styles.cardTitle}>{t('tokenLedgerCardTitle')}</span>
          <span className={styles.cardHint}>
            {count > 0
              ? t('tokenLedgerCardHintCount', { tokens: formatCount(grand) })
              : t('tokenLedgerCardHintEmpty')}
          </span>
        </button>
      </div>
      {open ? (
        <Modal title={t('tokenLedgerCardTitle')} onClose={() => setOpen(false)} closable>
          <div className={styles.intro}>{t('tokenLedgerIntro')}</div>
          <div className={styles.rows}>
            {KIND_ORDER.map((kind) => (
              <div key={kind} className={styles.row}>
                <span className={styles.kind}>{t(KIND_KEYS[kind])}</span>
                <span className={styles.barTrack}>
                  <span
                    className={styles.bar}
                    style={{
                      width:
                        totals && grand > 0
                          ? `${Math.max(2, Math.round((totals[kind] / grand) * 100))}%`
                          : '0',
                    }}
                  />
                </span>
                <span className={styles.value}>
                  {formatCount(totals ? totals[kind] : 0)}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.total}>
            {t('tokenLedgerTotal', { tokens: formatCount(grand), count })}
          </div>
          {entries.length > 0 ? (
            <div className={styles.history}>
              <div className={styles.historyTitle}>{t('tokenLedgerRecentTitle')}</div>
              {entries.map((entry) => (
                <div key={entry.id} className={styles.entry}>
                  <span className={styles.entryKind}>{t(KIND_KEYS[entry.kind])}</span>
                  <span className={styles.entryTokens}>{formatCount(entry.total)}</span>
                  <span className={styles.entryTime}>
                    {new Date(entry.at).toLocaleString([], {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.footer}>
            {count > 0 ? (
              <Button variant="outlined" size="m" onClick={() => void clearAll()}>
                {t('tokenLedgerClear')}
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
