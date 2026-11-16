import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconRefreshOutline16 } from '../base/icons.js'
import { MobileHeader } from '../session/MobileHeader.js'
import { DigestDialog } from './DigestDialog.js'
import { MemoryBrowser } from './MemoryPanel.js'
import styles from './MemoryPage.module.css'

/**
 * 归属选择：'all' 是全部，'global' 是全局（不属于任何项目的），
 * 其余是项目 id。用字符串而不是 null 当哨兵，是因为 null 在 JSX 里容易被当成「没选」。
 */
type Scope = 'all' | 'global' | string

/**
 * 记忆页：插件打开后占满主区域的一整页。
 * 桌面端顶部是标题与一句说明；移动端让开顶栏，标题交给顶栏显示。
 *
 * 一页里分三栏：全部 / 全局 / 各个项目。会话写记忆时会带上它所在的项目，
 * 所以「这个项目里聊过什么」和「关于我本人的事」能分开看——
 * 后者不挂在任何项目下，跨项目都该被记住。
 *
 * 「整理历史会话」在两处的位置不同但含义一致：
 * 桌面是标题右侧的按钮，移动端是顶栏最右边那个图标——
 * 顶栏右侧本来就是「新对话」，在记忆页这个位置上更该做的是整理，所以换成它。
 */
export const MemoryPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const projects = useChatStore((state) => state.projects)
  const [digesting, setDigesting] = useState(false)
  const [scope, setScope] = useState<Scope>('all')
  // 整理完会往库里写东西，关掉弹窗时让列表重读一次
  const [refreshKey, setRefreshKey] = useState(0)

  // 项目被删掉时选择还停在那个 id 上，退回「全部」，否则会看到一页永远空的记忆
  const active = useMemo<Scope>(() => {
    if (scope === 'all' || scope === 'global') {
      return scope
    }
    return projects.some((project) => project.id === scope) ? scope : 'all'
  }, [scope, projects])

  const projectId = active === 'all' ? undefined : active === 'global' ? null : active

  const tabs: { value: Scope; label: string }[] = [
    { value: 'all', label: t('memoryScopeAll') },
    { value: 'global', label: t('memoryScopeGlobal') },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ]

  return (
    <div className={styles.page}>
      {isMobile ? (
        <MobileHeader
          title={t('memoryPanelTitle')}
          action={
            <IconButton
              size="xl"
              tone="primary"
              tooltip={t('memoryDigestOpen')}
              icon={<IconRefreshOutline16 />}
              onClick={() => setDigesting(true)}
            />
          }
        />
      ) : null}
      <div className={styles.column}>
        <header className={styles.head}>
          <div className={styles.headMain}>
            {isMobile ? null : <h1 className={styles.title}>{t('memoryPanelTitle')}</h1>}
            {isMobile ? null : <p className={styles.subtitle}>{t('memoryPageSubtitle')}</p>}
          </div>
          {isMobile ? null : (
            <Button variant="outlined" size="m" onClick={() => setDigesting(true)}>
              {t('memoryDigestOpen')}
            </Button>
          )}
        </header>
        {tabs.length > 2 ? (
          <div className={styles.scopes} role="tablist" aria-label={t('memoryScopeLabel')}>
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active === tab.value}
                className={active === tab.value ? styles.scopeActive : styles.scope}
                onClick={() => setScope(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        <MemoryBrowser variant="page" refreshKey={refreshKey} projectId={projectId} />
      </div>
      {digesting ? (
        <DigestDialog
          onClose={() => {
            setDigesting(false)
            setRefreshKey((key) => key + 1)
          }}
        />
      ) : null}
    </div>
  )
}
