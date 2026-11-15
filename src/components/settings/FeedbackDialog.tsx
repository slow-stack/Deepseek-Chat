import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import {
  buildFeedbackBody,
  githubIssueUrl,
  mailtoUrl,
  plainFeedback,
  type FeedbackDraft,
} from '../../services/feedback.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './FeedbackDialog.module.css'

/**
 * 问题与反馈。三个出口共用同一份正文：
 * GitHub 工单（能跟进）、邮件（不想登 GitHub）、复制走（什么都不想登）。
 */
export const FeedbackDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [description, setDescription] = useState('')
  const [diagnostics, setDiagnostics] = useState(true)
  const draft: FeedbackDraft = { description, diagnostics }
  const empty = description.trim() === ''

  const open = (url: string) => {
    // 旁装 App 的 WebView 里 window.open 会把页面顶掉；target="_system" 才交给系统浏览器
    const link = document.createElement('a')
    link.href = url
    link.target = '_system'
    link.rel = 'noreferrer'
    link.click()
  }

  const copy = async () => {
    const ok = await copyText(plainFeedback(draft))
    showToast(
      ok
        ? { key: 'feedbackCopied' }
        : { key: 'feedbackCopyFailed', type: 'error' }
    )
  }

  return (
    <Modal
      title={t('feedbackTitle')}
      closable
      onClose={onClose}
      className={styles.modal}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="outlined" size="m" disabled={empty} onClick={() => void copy()}>
            {t('feedbackCopy')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            disabled={empty}
            onClick={() => open(mailtoUrl(draft))}
          >
            {t('feedbackMail')}
          </Button>
          <Button disabled={empty} size="m" onClick={() => open(githubIssueUrl(draft))}>
            {t('feedbackGithub')}
          </Button>
        </>
      }
    >
      <p className={styles.intro}>{t('feedbackIntro')}</p>
      <textarea
        className={styles.textarea}
        value={description}
        rows={7}
        placeholder={t('feedbackPlaceholder')}
        aria-label={t('feedbackPlaceholder')}
        onChange={(event) => setDescription(event.target.value)}
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={diagnostics}
          onChange={(event) => setDiagnostics(event.target.checked)}
        />
        <span>{t('feedbackDiagnosticsHint')}</span>
      </label>
      {diagnostics && !empty ? (
        <pre className={styles.preview}>{buildFeedbackBody(draft)}</pre>
      ) : null}
    </Modal>
  )
}
