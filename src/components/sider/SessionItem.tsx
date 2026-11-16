import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import {
  moveSessionToProject,
  prefetchSession,
  renameSession,
  selectSession,
  setSessionPinned,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { openChatPage } from '../../app/pageState.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import { toggleSelectSession } from './selectModeState.js'
import { MoveToProjectModal } from './MoveToProjectModal.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  selectMode = false,
  selected = false,
}: {
  session: SessionSummary
  active: boolean
  /** 收整个 session：调用方才能直接传稳定函数，不必每行新建闭包 */
  onDelete: (session: SessionSummary) => void
  /** 多选模式下点击整行只切换选中态，菜单也不再出现 */
  selectMode?: boolean
  selected?: boolean
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const hasProjects = useChatStore((state) => state.projects.length > 0)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  // 「移动到项目」收进二级弹窗：菜单里只留一个入口，选目标项目在弹窗里完成。
  const options: MenuOption[] = [
    {
      key: 'rename',
      label: t('sessionItemMenuRenameOption'),
      icon: <IconEditOutline16 />,
      onSelect: () => setEditing(true),
    },
    {
      key: 'pin',
      label: session.pinned ? t('unpinSession') : t('pinSession'),
      icon: <IconPinOutline16 />,
      onSelect: () => setSessionPinned(session.id, !session.pinned),
    },
    ...(hasProjects
      ? [
          {
            key: 'move-to-project',
            label: t('moveToProject'),
            icon: <IconFolderOutline16 />,
            onSelect: () => setMoving(true),
          },
        ]
      : []),
    ...(session.projectId
      ? [
          {
            key: 'move-out',
            label: t('projectMoveOut'),
            icon: <IconFolderOutline16 />,
            onSelect: () => moveSessionToProject(session.id, null),
          },
        ]
      : []),
    {
      key: 'delete',
      label: t('delete'),
      icon: <IconTrashOutline16 />,
      danger: true,
      onSelect: () => onDelete(session),
    },
  ]

  return (
    <div
      className={clsx(
        styles.item,
        active && !selectMode && styles.active,
        selectMode && selected && styles.selected
      )}
      // 悬停/按下先热一遍缓存，点下去时就不用等 IndexedDB 读盘
      onPointerEnter={() => prefetchSession(session.id)}
      onPointerDown={() => prefetchSession(session.id)}
      onClick={() => {
        if (selectMode) {
          toggleSelectSession(session.id)
          return
        }
        selectSession(session.id)
        // 显式回对话页：光靠 activeId 变化驱动不够——在记忆页点回当前这条会话时
        // activeId 没变，effect 不触发，人就卡在插件页出不去。
        openChatPage()
        closeMobileSider()
      }}
    >
      {selectMode ? (
        <span className={clsx(styles.checkbox, selected && styles.checkboxSelected)}>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      {session.pinned ? (
        <span className={styles.pin} aria-label={t('pinSession')}>
          <IconPinOutline16 />
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {selectMode ? null : (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu options={options}>
            {({ toggle }) => (
              <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
            )}
          </Menu>
        </div>
      )}
      {moving ? (
        <MoveToProjectModal
          excludeProjectId={session.projectId}
          onPick={(projectId) => moveSessionToProject(session.id, projectId)}
          onClose={() => setMoving(false)}
        />
      ) : null}
    </div>
  )
})
