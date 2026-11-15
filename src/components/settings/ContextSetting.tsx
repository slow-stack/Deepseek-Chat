import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { CONTEXT_WINDOW, getContextRatio } from '../../services/chat/compaction.js'
import { compactNow, getSessionContextTokens, useChatStore } from '../../services/chat/store.js'
import {
  setCompactKeepRounds,
  setCompactMode,
  setCompactThreshold,
  useSettings,
  type CompactMode,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { contextLevelOf, formatContextTokens } from '../contextLevel.js'
import styles from './ContextSetting.module.css'

const keepOptions = [2, 4, 6, 8, 10, 12, 16, 20]

/**
 * 上下文压缩设置：占用条 + 触发阈值 + 保留轮次 + 摘要方式 + 立即压缩 + 展开原文。
 * 数字跟着当前打开的会话走；没有打开会话时只显示设置本身。
 */
export const ContextSetting = () => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  return (
    <>
      <ContextUsage session={session} />
      <p className={styles.intro}>{t('contextSettingsIntro')}</p>
      <ContextSettings />
      <ContextActions session={session} />
    </>
  )
}

/** 当前会话的占用：没有打开会话时这段不出现，避免给一个假的 0% */
const ContextUsage = ({ session }: { session: Session | undefined }) => {
  const t = useTranslate()
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const compactKeepRounds = useSettings((state) => state.compactKeepRounds)
  if (!session) {
    return <p className={styles.intro}>{t('contextNoSession')}</p>
  }
  const tokens = getSessionContextTokens(session)
  const ratio = getContextRatio(tokens)
  const percent = Math.round(ratio * 100)
  const level = contextLevelOf(ratio, compactThreshold)
  return (
    <div className={styles.usage}>
      <div className={styles.usageHead}>
        <span className={styles.usageLabel}>{t('contextUsageLabel')}</span>
        <span className={clsx(styles.badge, level === 'hot' && styles.badgeHot)}>
          {percent}%
        </span>
      </div>
      <div className={styles.meter} aria-hidden="true">
        <div
          className={clsx(
            styles.meterFill,
            level === 'warm' && styles.meterWarm,
            level === 'hot' && styles.meterHot
          )}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <p className={styles.hint}>
        {t('contextUsageDetail', {
          tokens: formatContextTokens(tokens),
          window: formatContextTokens(CONTEXT_WINDOW),
          rounds: compactKeepRounds,
        })}
      </p>
    </div>
  )
}

const ContextSettings = () => {
  const t = useTranslate()
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const compactKeepRounds = useSettings((state) => state.compactKeepRounds)
  const compactMode = useSettings((state) => state.compactMode)
  return (
    <>
      <label className={styles.field}>
        <span className={styles.label}>
          {t('contextThresholdLabel')}
          <span className={styles.value}>{Math.round(compactThreshold * 100)}%</span>
        </span>
        <input
          className={styles.range}
          type="range"
          min={30}
          max={95}
          step={5}
          value={Math.round(compactThreshold * 100)}
          aria-label={t('contextThresholdLabel')}
          onChange={(event) => setCompactThreshold(Number(event.target.value) / 100)}
        />
        <span className={styles.hint}>{t('contextThresholdHint')}</span>
      </label>
      <div className={styles.field}>
        <span className={styles.label}>{t('contextKeepRoundsLabel')}</span>
        <Select
          ariaLabel={t('contextKeepRoundsLabel')}
          value={String(compactKeepRounds)}
          options={keepOptions.map((rounds) => ({ value: String(rounds), label: String(rounds) }))}
          onChange={(value) => setCompactKeepRounds(Number(value))}
        />
        <span className={styles.hint}>{t('contextKeepRoundsHint')}</span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>{t('contextModeLabel')}</span>
        <Select
          ariaLabel={t('contextModeLabel')}
          value={compactMode}
          options={[
            { value: 'local', label: t('contextModeLocal') },
            { value: 'model', label: t('contextModeModel') },
          ]}
          onChange={(value) => setCompactMode(value as CompactMode)}
        />
        <span className={styles.hint}>{t('contextModeHint')}</span>
      </div>
    </>
  )
}

/** 立即压缩 + 被压掉的原文。两者都只对当前打开的会话有意义 */
const ContextActions = ({ session }: { session: Session | undefined }) => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  if (!session) {
    return null
  }
  const compaction = session.compaction
  const compact = async () => {
    setBusy(true)
    try {
      const done = await compactNow(session.id)
      const next = useChatStore.getState().sessionCache[session.id]?.compaction
      setNotice(
        done && next ? t('contextCompactDone', { rounds: next.rounds }) : t('contextCompactNothing')
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="outlined"
          size="m"
          className={styles.actionButton}
          disabled={busy}
          onClick={() => void compact()}
        >
          {t('contextCompactNow')}
        </Button>
        {notice ? <span className={styles.notice}>{notice}</span> : null}
      </div>
      <p className={styles.hint}>{t('contextCompactNowHint')}</p>
      <div className={styles.original}>
        <button
          type="button"
          className={styles.originalToggle}
          aria-expanded={showOriginal}
          onClick={() => setShowOriginal((value) => !value)}
        >
          {showOriginal ? t('contextHideOriginal') : t('contextShowOriginal')}
          {compaction ? (
            <span className={styles.rounds}>{t('contextCompacted', { rounds: compaction.rounds })}</span>
          ) : null}
        </button>
        {showOriginal ? (
          <div className={styles.originalBody}>
            {compaction ? (
              <>
                <div className={styles.originalTitle}>{t('contextOriginalTitle')}</div>
                <pre className={styles.originalText}>{compaction.originalText}</pre>
              </>
            ) : (
              <p className={styles.hint}>{t('contextOriginalEmpty')}</p>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
