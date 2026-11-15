import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  DIGEST_DEFAULT_PICK,
  digestSessions,
  listDigestPending,
  type DigestOutcome,
  type DigestProgress,
} from '../../services/chat/memoryDigest.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './DigestDialog.module.css'

type Phase =
  | { kind: 'loading' }
  | { kind: 'picking' }
  | { kind: 'running' }
  | { kind: 'done'; outcome: DigestOutcome }

const formatDay = (time: number): string => {
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 整理导入的历史会话：列出还没整理过的，勾选后逐条抽成记忆。
 *
 * 刻意不自动跑：一次抽几百条既费钱，抽出来的东西也没人看过。
 * 这里只做「你看得见进度、随时能停」的队列，停下来的下次接着做。
 */
export const DigestDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [pending, setPending] = useState<SessionSummary[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<DigestProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' })
    try {
      const list = await listDigestPending()
      setPending(list)
      setPicked(new Set(list.slice(0, DIGEST_DEFAULT_PICK).map((session) => session.id)))
      setPhase({ kind: 'picking' })
    } catch {
      setPending([])
      setPicked(new Set())
      setPhase({ kind: 'picking' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 关掉弹窗或离开页面时把进行中的请求一起停掉，别让后台偷偷花钱
  useEffect(() => () => abortRef.current?.abort(), [])

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const start = async () => {
    const targets = pending.filter((session) => picked.has(session.id))
    if (targets.length === 0) {
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ kind: 'running' })
    setProgress({ total: targets.length, done: 0, current: null })
    const outcome = await digestSessions(targets, controller.signal, setProgress)
    abortRef.current = null
    setPhase({ kind: 'done', outcome })
    // 整理过的会从待整理里消失，回来时列表要是新的
    const rest = await listDigestPending().catch(() => [])
    setPending(rest)
    setPicked(new Set(rest.slice(0, DIGEST_DEFAULT_PICK).map((session) => session.id)))
  }

  const allPicked = pending.length > 0 && picked.size === pending.length

  return (
    <Modal
      title={t('memoryDigestTitle')}
      closable
      onClose={onClose}
      className={styles.modal}
      footer={
        phase.kind === 'running' ? (
          <Button variant="outlined" size="m" onClick={() => abortRef.current?.abort()}>
            {t('memoryDigestStop')}
          </Button>
        ) : phase.kind === 'done' ? (
          <>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('memoryDigestFinish')}
            </Button>
            {pending.length > 0 ? (
              <Button size="m" onClick={() => void load()}>
                {t('memoryDigestAgain')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('memoryDigestCancel')}
            </Button>
            <Button
              size="m"
              disabled={picked.size === 0 || phase.kind !== 'picking'}
              onClick={() => void start()}
            >
              {t('memoryDigestStart')}
            </Button>
          </>
        )
      }
    >
      <p className={styles.intro}>{t('memoryDigestIntro')}</p>
      {phase.kind === 'loading' ? (
        <div className={styles.status}>{t('memoryDigestLoading')}</div>
      ) : null}
      {phase.kind === 'picking' && pending.length === 0 ? (
        <div className={styles.notice}>
          <div className={styles.noticeTitle}>{t('memoryDigestEmpty')}</div>
          <div className={styles.noticeBody}>{t('memoryDigestEmptyHint')}</div>
        </div>
      ) : null}
      {phase.kind !== 'done' && pending.length > 0 ? (
        <>
          <div className={styles.toolbar}>
            <span className={styles.count}>{t('memoryDigestSelected', { count: picked.size })}</span>
            <div className={styles.toolbarActions}>
              <Button
                variant="outlined"
                size="s"
                disabled={phase.kind !== 'picking'}
                onClick={() =>
                  setPicked(
                    allPicked ? new Set() : new Set(pending.map((session) => session.id))
                  )
                }
              >
                {allPicked ? t('memoryDigestClear') : t('memoryDigestSelectAll')}
              </Button>
            </div>
          </div>
          <div className={styles.list}>
            {pending.map((session) => (
              <label key={session.id} className={styles.row}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={picked.has(session.id)}
                  disabled={phase.kind !== 'picking'}
                  onChange={() => toggle(session.id)}
                />
                <span className={styles.rowTitle}>{session.title || t('untitledChat')}</span>
                <span className={styles.rowMeta}>{formatDay(session.updatedAt)}</span>
              </label>
            ))}
          </div>
          <div className={styles.note}>{t('memoryDigestEstimate')}</div>
        </>
      ) : null}
      {phase.kind === 'running' && progress ? (
        <div className={styles.progress}>
          <div className={styles.progressLine}>
            {t('memoryDigestProgress', { done: progress.done, total: progress.total })}
          </div>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{
                width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
              }}
            />
          </div>
          {progress.current ? (
            <div className={styles.current}>
              {t('memoryDigestCurrent', { title: progress.current })}
            </div>
          ) : null}
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <div className={styles.result}>
          <div className={styles.resultTitle}>
            {phase.outcome.stopped ? t('memoryDigestStopped') : t('memoryDigestDone')}
          </div>
          <div className={styles.resultBody}>
            {t('memoryDigestResult', {
              saved: phase.outcome.saved,
              skipped: phase.outcome.skipped,
              failed: phase.outcome.failed,
            })}
          </div>
          <div className={styles.resultMeta}>
            {t('memoryDigestTokens', { tokens: phase.outcome.tokens })}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
