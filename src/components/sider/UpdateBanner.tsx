import type { AvailableUpdate } from '../../services/update.js'
import { useTranslate } from '../../i18n/index.js'
import { closeUpdateBanner, useUpdateBanner } from './updateBannerState.js'
import styles from './UpdateBanner.module.css'

/**
 * 侧栏底部的更新提示：只提示新版本并给出下载入口，下载与安装交给系统浏览器。
 *
 * Capacitor 的 WebView 用 target="_system" 把链接交给系统浏览器，那里下载完
 * 会走系统安装器；普通浏览器里这个属性没有副作用。
 */
const BannerBody = ({ update }: { update: AvailableUpdate }) => {
  const t = useTranslate()
  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <div className={styles.title}>
          {t('updateAvailableTitle')} {update.versionName}
        </div>
        {update.notes ? <div className={styles.notes}>{update.notes}</div> : null}
      </div>
      <a
        className={styles.action}
        href={update.downloadUrl}
        target="_system"
        rel="noreferrer"
        title={t('updateDownload')}
      >
        {t('updateDownload')}
      </a>
      <button
        type="button"
        className={styles.dismiss}
        onClick={closeUpdateBanner}
        title={t('updateDismiss')}
        aria-label={t('updateDismiss')}
      >
        ×
      </button>
    </div>
  )
}

export const UpdateBanner = () => {
  const update = useUpdateBanner((state) => state.update)
  if (!update) {
    return null
  }
  return <BannerBody update={update} />
}