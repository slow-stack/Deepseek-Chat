import { useCallback, useEffect, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  loadMnemeAuditEntries,
  loadMnemeAuditStats,
  mnemeAuditAvailable,
  type MnemeAuditEntryView,
  type MnemeAuditStats,
} from '../../services/chat/mnemeAudit.js'
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

/** mneme 审计的 operation_type → 文案 key；未知类型落到「其他」 */
const MNEME_OPERATION_KEYS: Record<string, TranslationKey> = {
  summarize_compress: 'mnemeAuditOpSummarizeCompress',
  dream_consolidate: 'mnemeAuditOpDreamConsolidate',
  dream_summarize: 'mnemeAuditOpDreamSummarize',
  entity_extract: 'mnemeAuditOpEntityExtract',
  pre_inject_gate: 'mnemeAuditOpPreInjectGate',
  profile_extract: 'mnemeAuditOpProfileExtract',
  profile_facts: 'mnemeAuditOpProfileFacts',
  sleep_pattern: 'mnemeAuditOpSleepPattern',
  sleep_affective: 'mnemeAuditOpSleepAffective',
  diary_compose: 'mnemeAuditOpDiaryCompose',
  write_admission: 'mnemeAuditOpWriteAdmission',
  storage_reclaim: 'mnemeAuditOpStorageReclaim',
}

const formatCount = (value: number): string => value.toLocaleString()

/**
 * Token 消耗卡：回答「记忆与整理一共花了多少 token、花在哪」。
 *
 * 分两块来源：
 * - 本机台账（tokenLedger）：这个应用自己的整理动作，只在真实拿到服务端 usage 时记账。
 * - mneme（DSH 侧）审计：宿主侧记忆引擎的账，走插件代理读现成聚合；代理不在（如 dev 页）就整块不显示。
 * 点开看按去向的分项和最近几笔流水。
 */
export const TokenLedgerCard = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [totals, setTotals] = useState<UsageTotals | null>(null)
  const [entries, setEntries] = useState<UsageEntryView[]>([])
  const [count, setCount] = useState(0)
  const [mnemeStats, setMnemeStats] = useState<MnemeAuditStats | null>(null)
  const [mnemeEntries, setMnemeEntries] = useState<MnemeAuditEntryView[]>([])
  const [mnemeState, setMnemeState] = useState<'hidden' | 'loading' | 'ready' | 'failed'>('hidden')

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
    if (await mnemeAuditAvailable()) {
      setMnemeState('loading')
      try {
        const [stats, items] = await Promise.all([loadMnemeAuditStats(30), loadMnemeAuditEntries(20)])
        setMnemeStats(stats)
        setMnemeEntries(items)
        setMnemeState('ready')
      } catch {
        setMnemeState('failed')
      }
    } else {
      setMnemeState('hidden')
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

  /** mneme 分区的分项：接口给的按操作聚合，按大小排序展示 */
  const mnemeRows = mnemeStats
    ? Object.entries(mnemeStats.byOperation)
        .filter(([, tokens]) => tokens > 0)
        .sort(([, a], [, b]) => b - a)
    : []
  const mnemeGrand = mnemeStats?.totalTokens ?? mnemeRows.reduce((sum, [, tokens]) => sum + tokens, 0)

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
          {mnemeState === 'ready' && mnemeStats ? (
            <div className={styles.mneme}>
              <div className={styles.historyTitle}>{t('mnemeAuditSectionTitle')}</div>
              <div className={styles.intro}>{t('mnemeAuditSectionIntro', { days: 30 })}</div>
              <div className={styles.rows}>
                {mnemeRows.map(([operation, tokens]) => (
                  <div key={operation} className={styles.row}>
                    <span className={styles.mnemeKind}>
                      {MNEME_OPERATION_KEYS[operation]
                        ? t(MNEME_OPERATION_KEYS[operation])
                        : operation}
                    </span>
                    <span className={styles.barTrack}>
                      <span
                        className={styles.bar}
                        style={{
                          width:
                            mnemeGrand > 0
                              ? `${Math.max(2, Math.round((tokens / mnemeGrand) * 100))}%`
                              : '0',
                        }}
                      />
                    </span>
                    <span className={styles.value}>{formatCount(tokens)}</span>
                  </div>
                ))}
              </div>
              <div className={styles.total}>
                {t('mnemeAuditTotal', {
                  tokens: formatCount(mnemeGrand),
                  count: mnemeStats.totalCalls,
                })}
              </div>
              {mnemeEntries.length > 0 ? (
                <div className={styles.history}>
                  <div className={styles.historyTitle}>{t('tokenLedgerRecentTitle')}</div>
                  {mnemeEntries.map((entry) => (
                    <div key={entry.id} className={styles.entry}>
                      <span className={styles.entryKind}>
                        {MNEME_OPERATION_KEYS[entry.operationType]
                          ? t(MNEME_OPERATION_KEYS[entry.operationType])
                          : entry.operationType}
                      </span>
                      <span className={styles.entryTokens}>{formatCount(entry.totalTokens)}</span>
                      <span className={styles.entryTime}>
                        {entry.at
                          ? new Date(entry.at).toLocaleString([], {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : mnemeState === 'loading' ? (
            <div className={styles.mneme}>
              <div className={styles.historyTitle}>{t('mnemeAuditSectionTitle')}</div>
              <div className={styles.intro}>{t('mnemeAuditLoading')}</div>
            </div>
          ) : mnemeState === 'failed' ? (
            <div className={styles.mneme}>
              <div className={styles.historyTitle}>{t('mnemeAuditSectionTitle')}</div>
              <div className={styles.intro}>{t('mnemeAuditFailed')}</div>
            </div>
          ) : null}
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
