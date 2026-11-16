import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  canInstallInApp,
  cancelInstall,
  downloadAndInstall,
  fileNameFromUrl,
  type InstallOutcome,
} from '../../services/apkUpdate.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { closeUpdateDialog, useUpdateBanner } from './updateBannerState.js'
import styles from './UpdateDialog.module.css'

/**
 * 升级流程的状态。App 里走「下载 → 校验 → 调起系统安装器」，
 * 网页里没有原生插件，直接退化成浏览器下载（phase 一直是 'idle'）。
 *
 * 'cancelling' 是「取消已经按了、还在等原生确认」。这个中间态必须留住：
 * 真正停下来的证据是原生回报，不是按钮点下去那一刻。如果取消没生效，
 * 进度条会继续往前走，一眼就能看出来，而不是界面先跳回空闲骗人。
 * 'late' 是取消得太晚——文件已经下完校验过了，只是没去装。
 */
type Phase = 'idle' | 'downloading' | 'verifying' | 'cancelling' | 'late' | 'permission' | 'failed'

type FailureKind = 'incomplete' | 'tampered' | 'unavailable' | 'failed'

/** 进度条上的百分比；拿不到总长时显示已下载的字节数 */
const progressText = (bytes: number, total: number | null) => {
  if (total && total > 0) {
    return `${Math.min(100, Math.round((bytes / total) * 100))}%`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 检测到新版本时弹出的确认框：列出这次改了什么，然后下载并装上。
 *
 * 「稍后」只收起这一次，侧栏提示条仍在，下次启动还会再问；侧栏提示条上的 ×
 * 才会写进 localStorage、这个版本以后不再打扰。
 *
 * 升级失败一律给两条路：重试、改用浏览器下载。任何时候都不能让用户
 * 点了升级却什么也做不了。
 */
const DialogBody = () => {
  const t = useTranslate()
  const update = useUpdateBanner((state) => state.update)
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState<{ bytes: number; total: number | null } | null>(null)
  const [failure, setFailure] = useState<{ kind: FailureKind; detail?: string } | null>(null)
  const [settingsOpened, setSettingsOpened] = useState(false)
  const cancelled = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const start = useCallback(async () => {
    if (!update) {
      return
    }
    cancelled.current = false
    setFailure(null)
    setPercent(null)
    setPhase('downloading')

    const outcome: InstallOutcome = await downloadAndInstall({
      url: update.downloadUrl,
      ...(update.sha256 ? { sha256: update.sha256 } : {}),
      ...(update.size ? { size: update.size } : {}),
      fileName: fileNameFromUrl(update.downloadUrl, update.versionName),
      isCancelled: () => cancelled.current,
      onProgress: (bytes, total) => {
        if (!mounted.current) {
          return
        }
        setPercent({ bytes, total })
        // 下完了切到「校验中」：原生那边接着算哈希，算完才会去调安装器
        if (total && total > 0 && bytes >= total) {
          setPhase('verifying')
        }
      },
    })
    if (!mounted.current) {
      return
    }

    // 用户自己按了取消：以原生回报的结局为准，不在这里擅自回位。
    // 收到 stopped 才安静回到初始状态；收到 completed 说明停晚了。
    if (outcome.ok) {
      // 系统安装器已经起来了：收掉弹窗，别挡在安装界面后面
      closeUpdateDialog()
      return
    }
    if (outcome.reason === 'cancelled') {
      if (outcome.detail === 'stopped') {
        setPercent(null)
        setPhase('idle')
        return
      }
      setPhase('late')
      return
    }
    if (outcome.reason === 'permission') {
      setSettingsOpened(outcome.settingsOpened)
      setPhase('permission')
      return
    }
    setFailure({ kind: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) })
    setPhase('failed')
  }, [update])

  if (!update) {
    return null
  }

  const points = update.highlights?.length
    ? update.highlights
    : update.notes
      ? [update.notes]
      : []

  const inApp = canInstallInApp()
  const busy = phase === 'downloading' || phase === 'verifying' || phase === 'cancelling'

  const failureText = () => {
    if (!failure) {
      return ''
    }
    if (failure.kind === 'incomplete') {
      return t('updateErrorIncomplete')
    }
    if (failure.kind === 'tampered') {
      return t('updateErrorTampered')
    }
    if (failure.kind === 'unavailable') {
      return t('updateErrorUnavailable')
    }
    return failure.detail ? t('updateErrorFailed', { detail: failure.detail }) : t('updateErrorFailedShort')
  }

  const footer = () => {
    if (phase === 'downloading') {
      return (
        <Button
          variant="outlined"
          onClick={() => {
            cancelled.current = true
            // 先进「正在取消」：等原生确认停下来再回位。按钮点下去不等于停了。
            setPhase('cancelling')
            void cancelInstall()
          }}
        >
          {t('updateCancel')}
        </Button>
      )
    }
    if (phase === 'cancelling') {
      return (
        <Button variant="outlined" disabled>
          {t('updateCancelling')}
        </Button>
      )
    }
    if (phase === 'verifying') {
      return (
        <Button variant="outlined" disabled>
          {t('updateVerifying')}
        </Button>
      )
    }
    if (phase === 'permission') {
      return (
        <>
          <a className={styles.downloadSecondary} href={update.downloadUrl} target="_system" rel="noreferrer">
            {t('updateBrowserDownload')}
          </a>
          <Button
            variant="primary"
            onClick={() => {
              setPhase('idle')
              void start()
            }}
          >
            {t('updateRetry')}
          </Button>
        </>
      )
    }
    return (
      <>
        <Button variant="outlined" onClick={closeUpdateDialog}>
          {t('updateLater')}
        </Button>
        {inApp ? (
          <Button variant="primary" onClick={() => void start()}>
            {phase === 'failed' || phase === 'late' ? t('updateRetry') : t('updateDownloadAndInstall')}
          </Button>
        ) : (
          <a
            className={styles.download}
            href={update.downloadUrl}
            target="_system"
            rel="noreferrer"
            onClick={closeUpdateDialog}
          >
            {t('updateDownload')}
          </a>
        )}
      </>
    )
  }

  return (
    <Modal
      title={`${t('updateDialogTitle')} ${update.versionName}`}
      closable={!busy}
      onClose={busy ? () => undefined : closeUpdateDialog}
      className={styles.dialog}
      footer={footer()}
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

      {phase === 'downloading' || phase === 'cancelling' ? (
        <div className={styles.progress}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{
                width: percent?.total
                  ? `${Math.min(100, Math.round((percent.bytes / percent.total) * 100))}%`
                  : '30%',
              }}
            />
          </div>
          <div className={styles.progressText}>
            {phase === 'cancelling'
              ? `${t('updateCancelling')} ${percent ? progressText(percent.bytes, percent.total) : ''}`.trim()
              : percent
                ? progressText(percent.bytes, percent.total)
                : t('updateDownloading')}
          </div>
        </div>
      ) : null}

      {phase === 'verifying' ? (
        <div className={styles.progressText}>{t('updateVerifying')}</div>
      ) : null}

      {phase === 'cancelling' ? <div className={styles.hint}>{t('updateCancellingHint')}</div> : null}

      {phase === 'late' ? <div className={styles.hint}>{t('updateCancelTooLate')}</div> : null}

      {phase === 'permission' ? (
        <div className={styles.hint}>
          {settingsOpened ? t('updatePermissionOpened') : t('updatePermissionManual')}
        </div>
      ) : null}

      {phase === 'failed' ? (
        <>
          <div className={styles.error}>{failureText()}</div>
          <a className={styles.fallbackLink} href={update.downloadUrl} target="_system" rel="noreferrer">
            {t('updateBrowserDownload')}
          </a>
        </>
      ) : null}
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
