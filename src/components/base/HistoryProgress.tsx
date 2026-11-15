import { useTranslate } from '../../i18n/index.js'
import { cancelHistoryImport, useChatStore } from '../../services/chat/store.js'
import styles from './HistoryProgress.module.css'

/**
 * 导入历史对话的进度条：挂在 App 上而不是设置弹窗里。
 * 导入本身跑在 store 的 replaceHistory 里，切页面、关设置都不影响；
 * 这条读的就是 store 里的进度，所以人走到哪一页都还看得见。
 */
export const HistoryProgress = () => {
  const t = useTranslate()
  const progress = useChatStore((state) => state.historyProgress)
  if (!progress) {
    return null
  }
  const committing = progress.phase === 'committing'
  const { done, total } = progress
  // 目录还没读完时总数未知，先给一条满格的动条，表示在跑而不假装有百分比。
  const percent = committing
    ? 100
    : total === null || total === 0
      ? null
      : Math.min(100, Math.round((done / total) * 100))
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>
            {t(committing ? 'historyImportCommitting' : 'historyImportReading')}
          </span>
          <span className={styles.count}>
            {percent === null
              ? t('historyImportCounting')
              : t('historyImportCount', { done, total: total ?? done, percent })}
          </span>
          {/* 已经进入写入阶段就不能撤了，否则会把半份数据搬进去。 */}
          {committing ? null : (
            <button
              type="button"
              className={styles.cancel}
              onClick={cancelHistoryImport}
              aria-label={t('historyImportCancel')}
            >
              {t('historyImportCancel')}
            </button>
          )}
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={percent === null ? `${styles.bar} ${styles.unknown}` : styles.bar}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        <p className={styles.hint}>{t('historyImportKeepOpen')}</p>
      </div>
    </div>
  )
}
