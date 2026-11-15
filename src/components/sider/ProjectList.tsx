import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderOutline16,
  IconPlusOutline14,
  IconTrashOutline16,
} from '../base/icons.js'
import { createProject, removeProject, renameProject, useChatStore } from '../../services/chat/store.js'
import type { SessionProject, SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { SessionItem } from './SessionItem.js'
import styles from './ProjectList.module.css'

/** 项目名输入：新建与重命名共用一个弹窗，空名不放行 */
const ProjectNameModal = ({
  title,
  initialValue,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string
  initialValue: string
  submitLabel: string
  onCancel: () => void
  onSubmit: (name: string) => void
}) => {
  const t = useTranslate()
  const [value, setValue] = useState(initialValue)
  const trimmed = value.trim()
  const submit = () => {
    if (trimmed) {
      onSubmit(trimmed)
    }
  }
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outlined" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={!trimmed} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <input
        className={styles.input}
        autoFocus
        value={value}
        placeholder={t('projectNamePlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            submit()
          }
        }}
      />
    </Modal>
  )
}

/**
 * 侧栏项目分组：会话按项目归类，成员会话只在这里出现，不再混进按时间分的列表。
 * 删项目只摘归类关系，会话本身留在列表里。
 */
export const ProjectList = ({
  activeId,
  onDelete,
}: {
  activeId: string | null
  onDelete: (session: SessionSummary) => void
}) => {
  const t = useTranslate()
  const projects = useChatStore((state) => state.projects)
  const sessions = useChatStore((state) => state.sessions)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<SessionProject | null>(null)
  const [removing, setRemoving] = useState<SessionProject | null>(null)

  // 一次遍历分好桶：会话数变化不用为每个项目重扫一遍。
  const members = useMemo(() => {
    const buckets = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      const projectId = session.projectId
      if (!projectId) {
        continue
      }
      const bucket = buckets.get(projectId)
      if (bucket) {
        bucket.push(session)
      } else {
        buckets.set(projectId, [session])
      }
    }
    return buckets
  }, [sessions])

  const toggle = (id: string) =>
    setCollapsed((current) => ({ ...current, [id]: !current[id] }))

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{t('projectsTitle')}</span>
        <IconButton
          icon={<IconPlusOutline14 />}
          tooltip={t('projectNew')}
          tooltipPlacement="bottom"
          onClick={() => setCreating(true)}
        />
      </div>
      {projects.length === 0 ? (
        <div className={styles.empty}>{t('projectEmpty')}</div>
      ) : (
        projects.map((project) => {
          const open = !collapsed[project.id]
          const rows = members.get(project.id) ?? []
          const hasActive = activeId !== null && rows.some((session) => session.id === activeId)
          const options: MenuOption[] = [
            {
              key: 'rename',
              label: t('projectMenuRename'),
              icon: <IconEditOutline16 />,
              onSelect: () => setRenaming(project),
            },
            {
              key: 'delete',
              label: t('projectMenuDelete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: () => setRemoving(project),
            },
          ]
          return (
            <div key={project.id} className={styles.project}>
              <div
                className={clsx(styles.row, hasActive && styles.active)}
                onClick={() => toggle(project.id)}
              >
                <span className={styles.chevron}>
                  {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                </span>
                <span className={styles.folder}>
                  <IconFolderOutline16 />
                </span>
                <span className={styles.name}>{project.name}</span>
                <span className={styles.count}>{rows.length}</span>
                <span className={styles.action} onClick={(event) => event.stopPropagation()}>
                  <Menu options={options}>
                    {({ toggle: openMenu }) => (
                      <IconButton
                        icon={<IconEllipsisOutline16 />}
                        tooltip={t('more')}
                        onClick={openMenu}
                      />
                    )}
                  </Menu>
                </span>
              </div>
              {open
                ? rows.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeId}
                      onDelete={onDelete}
                    />
                  ))
                : null}
            </div>
          )
        })
      )}
      {creating ? (
        <ProjectNameModal
          title={t('projectNew')}
          initialValue=""
          submitLabel={t('confirm')}
          onCancel={() => setCreating(false)}
          onSubmit={(name) => {
            createProject(name)
            setCreating(false)
          }}
        />
      ) : null}
      {renaming ? (
        <ProjectNameModal
          title={t('projectMenuRename')}
          initialValue={renaming.name}
          submitLabel={t('confirm')}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            renameProject(renaming.id, name)
            setRenaming(null)
          }}
        />
      ) : null}
      {removing ? (
        <Modal
          title={t('projectMenuDelete')}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setRemoving(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeProject(removing.id)
                  setRemoving(null)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('projectDeleteHint')}
        </Modal>
      ) : null}
    </div>
  )
}