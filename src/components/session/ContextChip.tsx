import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { useTranslate } from '../../i18n/index.js'
import { getContextRatio, CONTEXT_WINDOW } from '../../services/chat/compaction.js'
import { compactNow, getSessionContextTokens, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import {
  setCompactKeepRounds,
  setCompactMode,
  setCompactThreshold,
  useSettings,
  type CompactMode,
} from '../../services/settings.js'
import styles from './ContextChip.module.css'

/** 占用比例对应的视觉档位：正常、偏高、达到阈值 */
const levelOf = (ratio: number, threshold: number): 'normal' | 'warm' | 'hot' => {
  if (ratio >= threshold) {
    return 'hot'
  }
  return ratio >= threshold * 0.75 ? 'warm' : 'normal'
}

const formatTokens = (tokens: number) =>
  tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)

const keepOptions = [2, 4, 6, 8, 10, 12, 16, 20]

/**
 * 顶栏上下文占用指示器：数字是当前占用窗口的比例，颜色随阈值变化。
 * 点开是压缩设置与「立即压缩」，下面还能展开看被压掉的原文——不做黑盒。
 */
export const ContextChip = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const compactKeepRounds = useSettings((state) => state.compactKeepRounds)
  const compactMode = useSettings((state) => state.compactMode)
  const tokens = getSessionContextTokens(session)
  const ratio = getContextRatio(tokens)
  const percent = Math.round(ratio * 100)
  const level = levelOf(ratio, compactThreshold)
  const compaction = session.compaction
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLButtonElement, HTMLDivElement>(
    open,
    { side: 'bottom', align: 'end', offset: 6, maxHeight: 560, minSpace: 240, measureKey: notice }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const compact = async () => {
    setBusy(true)
    try {
      const done = await compactNow(session.id)
      const next = useChatStore.getState().sessionCache[session.id]?.compaction
      setNotice(
        done && next
          ? t('contextCompactDone', { rounds: next.rounds })
          : t('contextCompactNothing')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(
          styles.chip,
          level === 'warm' && styles.chipWarm,
          level === 'hot' && styles.chipHot
        )}
        aria-label={t('contextChipLabel', { percent })}
        aria-expanded={open}
        title={t('contextChipHint', { percent })}
        onClick={() => {
          setNotice(null)
          setOpen((value) => !value)
        }}
      >
        {percent}%
      </button>
      {open &&
        createPortal(
          <div
            ref={floatingRef}
            className={styles.panel}
            style={
              position
                ? { top: position.top, right: position.right, maxHeight: position.maxHeight }
                : { top: 0, right: 0, visibility: 'hidden' }
            }
            role="dialog"
            aria-label={t('contextPanelTitle')}
          >
            <div className={styles.header}>
              <span className={styles.title}>{t('contextPanelTitle')}</span>
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
            <p className={styles.detail}>
              {t('contextUsageDetail', {
                tokens: formatTokens(tokens),
                window: formatTokens(CONTEXT_WINDOW),
                rounds: compactKeepRounds,
              })}
            </p>

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
                onChange={(event) => setCompactThreshold(Number(event.target.value) / 100)}
              />
              <span className={styles.hint}>{t('contextThresholdHint')}</span>
            </label>

            <div className={styles.field}>
              <span className={styles.label}>{t('contextKeepRoundsLabel')}</span>
              <Select
                ariaLabel={t('contextKeepRoundsLabel')}
                value={String(compactKeepRounds)}
                options={keepOptions.map((rounds) => ({
                  value: String(rounds),
                  label: String(rounds),
                }))}
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

            <div className={styles.actions}>
              <Button size="s" disabled={busy} onClick={() => void compact()}>
                {t('contextCompactNow')}
              </Button>
              {notice && <span className={styles.notice}>{notice}</span>}
            </div>

            <div className={styles.original}>
              <button
                type="button"
                className={styles.originalToggle}
                aria-expanded={showOriginal}
                onClick={() => setShowOriginal((value) => !value)}
              >
                {showOriginal ? t('contextHideOriginal') : t('contextShowOriginal')}
                {compaction && (
                  <span className={styles.rounds}>
                    {t('contextCompacted', { rounds: compaction.rounds })}
                  </span>
                )}
              </button>
              {showOriginal && (
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
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
