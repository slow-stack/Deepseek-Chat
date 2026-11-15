import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { getContextRatio } from '../../services/chat/compaction.js'
import { getSessionContextTokens } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { contextLevelOf } from '../contextLevel.js'
import type { Session } from '../../services/chat/types.js'
import styles from './ContextChip.module.css'

/**
 * 顶栏上下文占用指示器：数字是当前占用窗口的比例，颜色随阈值变化。
 * 点开直接跳到设置 → 上下文，压缩的调整与原文都在那一页。
 */
export const ContextChip = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const tokens = getSessionContextTokens(session)
  const ratio = getContextRatio(tokens)
  const percent = Math.round(ratio * 100)
  const level = contextLevelOf(ratio, compactThreshold)
  return (
    <button
      type="button"
      className={clsx(
        styles.chip,
        level === 'warm' && styles.chipWarm,
        level === 'hot' && styles.chipHot
      )}
      aria-label={t('contextChipLabel', { percent })}
      title={t('contextChipHint', { percent })}
      onClick={() => openSettings('context')}
    >
      {percent}%
    </button>
  )
}
