import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { closeUpdateDialog, useUpdateBanner } from './updateBannerState.js'
import styles from './UpdateDialog.module.css'

/**
 * 检测到新版本时弹出的确认框：列出这次改了什么，用户选择去下载或稍后。
 *
 * 「稍后」只收起这一次，侧栏提示条仍在，下次启动还会再问；侧栏提示条上的 ×
 * 才会写进 localStorage、这个版本以后不再打扰。下载交给系统浏览器，不接管安装。
 */
const DialogBody = () => {
  const t = useTranslate()
  const update = useUpdateBanner((state) => state.update)
  if (!update) {
    return null
  }
  const points = update.highlights?.length
    ? update.highlights
    : update.notes
      ? [update.notes]
      : []
  return (
    <Modal
      title={`${t('updateDialogTitle')} ${update.versionName}`}
      closable
      onClose={closeUpdateDialog}
      className={styles.dialog}
      footer={
        <>
          <Button variant="outlined" onClick={closeUpdateDialog}>
            {t('updateLater')}
          </Button>
          <a
            className={styles.download}
            href={update.downloadUrl}
            target="_system"
            rel="noreferrer"
            onClick={closeUpdateDialog}
          >
            {t('updateDownload')}
          </a>
        </>
      }
    >
      <div className={styles.version}>
        {t('updateCurrentVersion', { version: update.current })}
        <span className={styles.arrow}>→</span>
        <span className={styles.newVersion}>{update.versionName}</span>
      </div>
      {points.length > 0 ? (
        <>
          <div className={styles.sectionTitle}>{t('updateDialogChanges')}</div>
          <ul className={styles.changes}>
            {points.map((point) => (
              <li key={point} className={styles.change}>
                {point}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={styles.notes}>{t('updateDialogNoNotes')}</div>
      )}
    </Modal>
  )
}

export const UpdateDialog = () => {
  const open = useUpdateBanner((state) => state.dialogOpen)
  if (!open) {
    return null
  }
  return <DialogBody />
}
