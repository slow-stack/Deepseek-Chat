import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { cancelHistoryExport, cancelHistoryImport, useChatStore } from '../../services/chat/store.js'
import styles from './HistoryProgress.module.css'

/**
 * 导入 / 导出的进度条：挂在 App 上而不是设置弹窗里。
 * 两条流程都跑在 store 里，切页面、关设置都不影响；
 * 这条读的就是 store 里的进度，所以人走到哪一页都还看得见。
 */
export const HistoryProgress = () => {
  const t = useTranslate()
  const progress = useChatStore((state) => state.historyProgress)
  if (!progress) {
    return null
  }
  const { kind, phase, done, total } = progress
  const packing = phase === 'packing'
  const saving = phase === 'saving'
  const committing = phase === 'committing'
  const settled = packing || saving || committing
  // 导入的写入阶段不能撤，否则会把半份数据搬进去；导出只有打包能在内存里中止，
  // 写进用户挑的位置后停下会留个坏文件，所以 saving 也不给取消。
  const canCancel = kind === 'export' ? !saving : !committing
  const titleKey: TranslationKey =
    kind === 'export'
      ? saving
        ? 'historyExportSaving'
        : packing
          ? 'historyExportPacking'
          : 'historyExportReading'
      : committing
        ? 'historyImportCommitting'
        : 'historyImportReading'
  const hintKey: TranslationKey =
    kind === 'export' ? 'historyExportKeepOpen' : 'historyImportKeepOpen'
  // 已导出的会话数只在导出侧有意义；导入侧报的是条目数。
  const counted = total !== null && total > 0 && !settled
  const percent = counted ? Math.min(100, Math.round((done / total) * 100)) : null
  const countKey: TranslationKey =
    kind === 'export'
      ? saving
        ? 'historyExportSavingHint'
        : packing
          ? 'historyExportPacked'
          : counted
            ? 'historyExportCount'
            : 'historyExportCounting'
      : counted
        ? 'historyImportCount'
        : 'historyImportCounting'
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>{t(titleKey)}</span>
          <span className={styles.count}>
            {t(countKey, { done, total: total ?? done, percent: percent ?? 0 })}
          </span>
          {/* 收尾阶段不能撤了：导入会搬进半份数据，导出会留下半个 ZIP。 */}
          {canCancel ? (
            <button
              type="button"
              className={styles.cancel}
              onClick={kind === 'export' ? cancelHistoryExport : cancelHistoryImport}
              aria-label={t('historyImportCancel')}
            >
              {t('historyImportCancel')}
            </button>
          ) : null}
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
        <p className={styles.hint}>{t(hintKey)}</p>
      </div>
    </div>
  )
}
