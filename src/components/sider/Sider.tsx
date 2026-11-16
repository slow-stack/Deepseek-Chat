import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSelectListOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  moveSessionToProject,
  newChat,
  removeSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { useEnabledPlugins } from '../../plugins/registry.js'
import { openChatPage, openPage, useAppPage } from '../../app/pageState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import {
  enterSelectMode,
  exitSelectMode,
  setSelectedSessions,
  useSelectMode,
} from './selectModeState.js'
import { MoveToProjectModal } from './MoveToProjectModal.js'
import { ProjectList } from './ProjectList.js'
import { SessionItem } from './SessionItem.js'
import { UpdateBanner } from './UpdateBanner.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、置顶与项目、按时间分组的会话列表、底部设置；移动端放在抽屉里 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  // 归进项目的会话只在项目下显示，不再混进按时间分的分组；置顶的浮到「置顶」分组
  const looseSessions = useMemo(
    () => sessions.filter((session) => !session.projectId),
    [sessions]
  )
  const pinnedSessions = useMemo(
    () =>
      looseSessions
        .filter((session) => session.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [looseSessions]
  )
  const groups = useMemo(
    () => groupSessions(looseSessions.filter((session) => !session.pinned), now, t),
    [looseSessions, now, t]
  )
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  // 置顶分组默认展开，收起状态记在侧栏本地
  const [pinnedOpen, setPinnedOpen] = useState(true)
  // 多选模式：清单图标进入，勾选会话后底部工具条批量删除 / 移动到项目
  const selectMode = useSelectMode((state) => state.active)
  const selectedIds = useSelectMode((state) => state.selectedIds)
  const [batchMoving, setBatchMoving] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDeletePending, setBatchDeletePending] = useState(false)
  // 侧栏搜索：标题子串匹配，命中后直接平铺结果，不再按项目与时间分组
  const [query, setQuery] = useState('')
const [searchOpen, setSearchOpen] = useState(false)
  const search = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      search
        ? sessions.filter((session) => (session.title || t('untitledChat')).toLowerCase().includes(search))
        : [],
    [sessions, search, t]
  )
  // 启用的插件才在侧栏底部各占一行入口
  const plugins = useEnabledPlugins()
  const page = useAppPage((state) => state.page)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // 更新检查在 App 里统一触发，侧栏收起或移动端抽屉关着时也能提示

  const enterSelect = () => {
    setQuery('')
    enterSelectMode()
  }

  // 全选/全不选：全部选中时再点一次清空
  const allSelected = selectedIds.length > 0 && selectedIds.length === sessions.length
  const toggleSelectAll = () => {
    setSelectedSessions(allSelected ? [] : sessions.map((session) => session.id))
  }

  /** 批量删除：逐条走单个删除流程（停流、清缓存、清原件引用），失败的不从选择里去掉。 */
  const deleteSelected = async () => {
    setBatchDeletePending(true)
    try {
      const failed: string[] = []
      for (const id of selectedIds) {
        if (!(await removeSession(id))) {
          failed.push(id)
        }
      }
      if (failed.length === selectedIds.length) {
        showToast({ key: 'sessionDeleteFailed', type: 'error' })
      } else {
        setSelectedSessions(failed)
        if (failed.length === 0) {
          exitSelectMode()
        }
      }
    } finally {
      setBatchDeletePending(false)
    }
  }

  /** 批量移动到项目：选择集里的会话统一改 projectId，已在目标项目里的等于没动。 */
  const moveSelectedToProject = (projectId: string) => {
    for (const id of selectedIds) {
      moveSessionToProject(id, projectId)
    }
    exitSelectMode()
  }

  const sessionItemProps = (session: SessionSummary) => ({
    session,
    active: session.id === activeId,
    onDelete: () => setDeleting(session),
    selectMode,
    selected: selectedIds.includes(session.id),
  })

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <div className={styles.appName}>{t('appName')}</div>
        </div>
        {/* 搜索收成一个图标：常驻输入框占掉一整行，多数时候用不上。
            点开就地展开输入框，清空或失焦回到图标；有词时保持展开。 */}
        {searchOpen || query ? (
          <IconButton
            size="m"
            icon={<IconCloseOutline16 />}
            tooltip={t('siderSearchClear')}
            tooltipPlacement="bottom"
            onClick={() => {
              setQuery('')
              setSearchOpen(false)
            }}
          />
        ) : (
          <IconButton
            size="m"
            icon={<IconSearchOutline16 />}
            tooltip={t('siderSearchPlaceholder')}
            tooltipPlacement="bottom"
            onClick={() => setSearchOpen(true)}
          />
        )}
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          openChatPage()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {searchOpen || query ? (
        <div className={styles.search}>
          <span className={styles.searchIcon}>
            <IconSearchOutline16 />
          </span>
          <input
            className={styles.searchInput}
            value={query}
            placeholder={t('siderSearchPlaceholder')}
            aria-label={t('siderSearchPlaceholder')}
            autoFocus
            onBlur={(event) => {
              // 没输入词就失焦收起，别让一个空输入框常驻
              if (!event.target.value) {
                setSearchOpen(false)
              }
            }}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label={t('siderSearchClear')}
              onClick={() => setQuery('')}
            >
              <IconCloseOutline16 />
            </button>
          ) : null}
        </div>
      ) : null}
      {/* 列表头：参考 DeepSeek App，左边是可折叠的「置顶」，右边是多选入口；多选时换成已选计数与全选 */}
      <div className={styles.listHeader}>
        {selectMode ? (
          <>
            <span className={styles.headerLabel}>{t('selectedCount', { count: selectedIds.length })}</span>
            <span className={styles.headerActions}>
              <button type="button" className={styles.headerButton} onClick={toggleSelectAll}>
                {t('selectAll')}
              </button>
              <IconButton
                size="m"
                icon={<IconCloseOutline16 />}
                tooltip={t('exitSelectSessions')}
                onClick={exitSelectMode}
              />
            </span>
          </>
        ) : (
          <>
            {pinnedSessions.length > 0 ? (
              <button
                type="button"
                className={clsx(styles.headerButton, styles.pinnedToggle)}
                onClick={() => setPinnedOpen((value) => !value)}
                aria-expanded={pinnedOpen}
              >
                {t('pinnedSectionTitle')}
                <span className={clsx(styles.chevron, pinnedOpen && styles.chevronOpen)}>
                  <IconChevronDownOutline14 />
                </span>
              </button>
            ) : null}
            <IconButton
              size="m"
              icon={<IconSelectListOutline16 />}
              tooltip={t('selectSessions')}
              onClick={enterSelect}
            />
          </>
        )}
      </div>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {search ? (
            matches.length ? (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>{t('siderSearchResults')}</div>
                {matches.map((session) => (
                  <SessionItem key={session.id} {...sessionItemProps(session)} />
                ))}
              </div>
            ) : (
              <div className={styles.searchEmpty}>{t('siderSearchEmpty')}</div>
            )
          ) : (
            <>
              {pinnedSessions.length > 0 && pinnedOpen ? (
                <div className={styles.section}>
                  {pinnedSessions.map((session) => (
                    <SessionItem key={session.id} {...sessionItemProps(session)} />
                  ))}
                </div>
              ) : null}
              <ProjectList
                activeId={activeId}
                onDelete={setDeleting}
                selectMode={selectMode}
                selectedIds={selectedIds}
              />
              {groups.map((group) => (
                <div key={group.key} className={styles.section}>
                  <div className={styles.sectionHeader}>{group.label}</div>
                  {group.sessions.map((session) => (
                    <SessionItem key={session.id} {...sessionItemProps(session)} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {selectMode ? (
        <div className={styles.batchBar}>
          <Button
            variant="primary"
            disabled={selectedIds.length === 0}
            onClick={() => setBatchMoving(true)}
          >
            {t('moveToProject')}
          </Button>
          <Button
            variant="danger"
            disabled={selectedIds.length === 0}
            onClick={() => setBatchDeleting(true)}
          >
            {t('delete')}
          </Button>
        </div>
      ) : null}
      <UpdateBanner />
      <div className={styles.bottom}>
        {plugins.map((plugin) => (
          <button
            key={plugin.id}
            type="button"
            className={clsx(styles.pluginEntry, page === plugin.id && styles.entryActive)}
            aria-current={page === plugin.id ? 'page' : undefined}
            onClick={() => {
              openPage(plugin.id)
              closeMobileSider()
            }}
          >
            <span className={styles.settingsIcon}>{plugin.icon}</span>
            <span className={styles.settingsLabel}>{t(plugin.title)}</span>
          </button>
        ))}
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    const ok = await removeSession(deleting.id)
                    // 成败都先关弹框：留着只会像「点了没反应」，失败信息有 toast 负责。
                    setDeleting(null)
                    if (!ok) {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {batchMoving ? (
        <MoveToProjectModal
          onPick={moveSelectedToProject}
          onClose={() => setBatchMoving(false)}
        />
      ) : null}
      {batchDeleting ? (
        <Modal
          title={t('deleteSessionsModalContentTitle', { count: selectedIds.length })}
          onClose={() => {
            if (!batchDeletePending) {
              setBatchDeleting(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={batchDeletePending}
                onClick={() => setBatchDeleting(false)}
              >
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={batchDeletePending} onClick={deleteSelected}>
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionsDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
