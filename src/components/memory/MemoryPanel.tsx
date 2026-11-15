import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { loadMemories, type MemoryRecord } from '../../services/chat/memoryRead.js'
import { Button } from '../base/Button.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './MemoryPanel.module.css'

/** 一页取多少条；「加载更多」按这个步长往后翻 */
const PAGE_SIZE = 20

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: MemoryRecord[]; total: number | null; mode: string | null }
  | { kind: 'failed' }

const formatDate = (value: string | null): string => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 记忆浏览：检索或按时间翻看记忆库，读的是 mneme 记忆服务。
 * 记忆页整页用它（variant='page'），设置里的小窗用它（variant='panel'）。
 */
export const MemoryBrowser = ({
  variant = 'panel',
  refreshKey = 0,
}: {
  variant?: 'panel' | 'page'
  /** 外部写入记忆后改这个数，列表会重新读一遍 */
  refreshKey?: number
}) => {
  const t = useTranslate()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  const requestId = useRef(0)

  // 搜索框停顿 350ms 再查，避免每敲一个字打一次请求
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft.trim()), 350)
    return () => clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    const id = ++requestId.current
    setState({ kind: 'loading' })
    loadMemories({ query, limit: PAGE_SIZE })
      .then((page) => {
        if (id !== requestId.current) {
          return
        }
        setState({ kind: 'ready', items: page.items, total: page.total, mode: page.mode })
      })
      .catch(() => {
        if (id !== requestId.current) {
          return
        }
        setState({ kind: 'failed' })
      })
  }, [query, refreshKey])

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || moreBusy) {
      return
    }
    setMoreBusy(true)
    try {
      const page = await loadMemories({ query, limit: PAGE_SIZE, offset: state.items.length })
      setState({
        kind: 'ready',
        items: [...state.items, ...page.items],
        total: page.total ?? state.total,
        mode: page.mode ?? state.mode,
      })
    } catch {
      // 翻页失败就停在原处，不把已经拿到的结果清掉
    } finally {
      setMoreBusy(false)
    }
  }, [state, moreBusy, query])

  const hint =
    state.kind === 'failed' ? (
      <div className={styles.notice}>
        <div className={styles.noticeTitle}>{t('memoryPanelFailed')}</div>
        <div className={styles.noticeBody}>{t('memoryPanelFailedHint')}</div>
        <Button variant="outlined" size="m" onClick={() => openSettings('plugins')}>
          {t('memoryPanelOpenSettings')}
        </Button>
      </div>
    ) : null

  const items = state.kind === 'ready' ? state.items : []
  const total = state.kind === 'ready' ? state.total : null

  return (
    <div className={clsx(styles.section, variant === 'page' && styles.pageSection)}>
      <div className={styles.search}>
        <input
          className={styles.searchInput}
          value={draft}
          placeholder={t('memoryPanelSearchPlaceholder')}
          aria-label={t('memoryPanelSearchPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        {state.kind === 'loading' ? (
          <div className={styles.status}>{t('memoryPanelLoading')}</div>
        ) : null}
        {hint}
        {state.kind === 'ready' && items.length === 0 ? (
          <div className={styles.notice}>
            <div className={styles.noticeTitle}>{t('memoryPanelEmpty')}</div>
            <div className={styles.noticeBody}>{t('memoryPanelEmptyHint')}</div>
          </div>
        ) : null}
        {items.map((item) => {
          const isOpen = expanded === item.id
          return (
            <div key={item.id} className={styles.item}>
              <button
                type="button"
                className={styles.itemHead}
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : item.id)}
              >
                <span className={styles.itemTitle}>{item.title || item.content.slice(0, 40)}</span>
                <span className={styles.itemMeta}>
                  <span className={styles.typeTag}>{item.type}</span>
                  {formatDate(item.occurredAt ?? item.createdAt)}
                </span>
              </button>
              <div className={isOpen ? styles.itemContentOpen : styles.itemContent}>
                {item.content}
              </div>
            </div>
          )
        })}
      </div>
      <div className={styles.footer}>
        <span className={styles.counter}>
          {total === null
            ? t('memoryPanelShownCount', { count: items.length })
            : t('memoryPanelTotal', { count: total })}
        </span>
        {items.length > 0 && (total === null || items.length < total) ? (
          <Button size="m" variant="outlined" disabled={moreBusy} onClick={() => void loadMore()}>
            {t('memoryPanelLoadMore')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}