import { useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadMemories } from '../../services/chat/memoryRead.js'
import {
  PROFILE_MEMORY_ID,
  SUMMARY_MEMORY_ID,
  generateProfile,
  generateSummary,
} from '../../services/chat/memoryProfile.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ProfileCards.module.css'

type ProfileKind = 'profile' | 'summary'

/**
 * 用户画像与记忆摘要：两张并排的卡，点开是一篇按主题分节的第二人称叙述。
 * 参考 ChatGPT 的记忆摘要——不是一堆条目，而是「你是……」的一目了然的人话。
 *
 * 生成 = 把记忆库里的条目重新组织一遍（走摘要模型，不回读会话原文），
 * 结果以固定 id 覆盖写进记忆库，所以它自己也会出现在列表里。
 * 已生成过的直接展示全文；没有就给一个「生成」按钮。
 */
export const ProfileCards = () => {
  const t = useTranslate()
  const [open, setOpen] = useState<ProfileKind | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [delta, setDelta] = useState('')
  const [updated, setUpdated] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadExisting = async (kind: ProfileKind) => {
    const id = kind === 'profile' ? PROFILE_MEMORY_ID : SUMMARY_MEMORY_ID
    const page = await loadMemories({ limit: 1 }).catch(() => null)
    const record = page?.items.find((item) => item.id === id)
    return record?.content ?? null
  }

  const openCard = async (kind: ProfileKind) => {
    setOpen(kind)
    setText('')
    setDelta('')
    const existing = await loadExisting(kind)
    if (existing) {
      setText(existing)
      return
    }
    // 没有现成的就自动生成一次：用户点的就是「看画像」，别再让他多点一步
    void generate(kind)
  }

  const generate = async (kind: ProfileKind) => {
    setBusy(true)
    setDelta('')
    try {
      // 全库条目：分页拉到没有为止（generate 侧会按时间排序、截断）
      const records = []
      for (let offset = 0; ; offset += 100) {
        const page = await loadMemories({ limit: 100, offset })
        records.push(...page.items)
        if (page.total === null || offset + 100 >= page.total) {
          break
        }
      }
      const controller = new AbortController()
      abortRef.current = controller
      let buffer = ''
      const result =
        kind === 'profile'
          ? await generateProfile(records, controller.signal, (piece) => {
              buffer += piece
              setDelta(buffer.slice(-400))
            })
          : await generateSummary(records, controller.signal, (piece) => {
              buffer += piece
              setDelta(buffer.slice(-400))
            })
      setText(result)
      setDelta('')
      setUpdated(new Date().toLocaleString())
      showToast({ key: kind === 'profile' ? 'profileGenerated' : 'summaryGenerated' })
    } catch {
      showToast({ key: 'profileGenerateFailed', type: 'error' })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  const title = useMemo(
    () => (open === 'profile' ? t('profileCardTitle') : t('summaryCardTitle')),
    [open, t]
  )

  return (
    <>
      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={() => void openCard('profile')}>
          <span className={styles.cardTitle}>{t('profileCardTitle')}</span>
          <span className={styles.cardHint}>{t('profileCardHint')}</span>
        </button>
        <button type="button" className={styles.card} onClick={() => void openCard('summary')}>
          <span className={styles.cardTitle}>{t('summaryCardTitle')}</span>
          <span className={styles.cardHint}>{t('summaryCardHint')}</span>
        </button>
      </div>
      {open ? (
        <Modal
          title={title}
          onClose={() => {
            if (!busy) {
              setOpen(null)
            }
          }}
        >
          <div className={styles.meta}>
            {updated ? <span>{t('profileUpdatedAt', { time: updated })}</span> : null}
          </div>
          <div className={styles.body}>
            {text ? <Markdownish text={text} /> : busy ? <p className={styles.delta}>{delta || t('profileGenerating')}</p> : null}
          </div>
          <div className={styles.footer}>
            {busy ? (
              <Button variant="outlined" size="m" onClick={stop}>
                {t('profileStop')}
              </Button>
            ) : (
              <Button variant="outlined" size="m" onClick={() => void generate(open)}>
                {t('profileRegenerate')}
              </Button>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

/**
 * 轻量 Markdown 渲染：只处理生成结果里实际会用到的形状——
 * ## 标题、- 列表、普通段落。不引库、不追求完整语法。
 */
const Markdownish = ({ text }: { text: string }) => {
  const blocks = text.split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n').filter((line) => line.trim())
        if (lines.length === 0) {
          return null
        }
        const heading = lines[0].match(/^#{1,6}\s+(.*)$/)
        if (heading) {
          return (
            <section key={index}>
              <h3 className={styles.h}>{heading[1]}</h3>
              <p className={styles.p}>{lines.slice(1).join(' ')}</p>
            </section>
          )
        }
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index} className={styles.ul}>
              {lines.map((line, i) => (
                <li key={i}>{line.replace(/^\s*[-*]\s+/, '')}</li>
              ))}
            </ul>
          )
        }
        return <p key={index} className={styles.p}>{lines.join(' ')}</p>
      })}
    </>
  )
}
