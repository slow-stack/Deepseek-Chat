import { useTranslate } from '../../i18n/index.js'
import { IconFolderOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { useChatStore } from '../../services/chat/store.js'
import styles from './MoveToProjectModal.module.css'

/**
 * 「移动到项目」弹窗：把项目的平铺菜单收进二级选择，点一个项目立刻移动并关闭。
 * excludeProjectId 用来隐藏会话当前所在的项目，避免点了没变化。
 */
export const MoveToProjectModal = ({
  excludeProjectId,
  onPick,
  onClose,
}: {
  excludeProjectId?: string | null
  onPick: (projectId: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  const projects = useChatStore((state) => state.projects)
  const sessions = useChatStore((state) => state.sessions)
  const candidates = projects.filter((project) => project.id !== excludeProjectId)
  // 每个项目显示成员数，选中时更有把握
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const projectId = session.projectId
    if (projectId) {
      counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
    }
  }

  return (
    <Modal title={t('moveToProject')} onClose={onClose} mainClassName={styles.list}>
      {candidates.length === 0 ? (
        <div className={styles.empty}>{t('moveToProjectEmpty')}</div>
      ) : (
        candidates.map((project) => (
          <button
            key={project.id}
            type="button"
            className={styles.option}
            onClick={() => {
              onPick(project.id)
              onClose()
            }}
          >
            <span className={styles.folder}>
              <IconFolderOutline16 />
            </span>
            <span className={styles.name}>{project.name}</span>
            <span className={styles.count}>{counts.get(project.id) ?? 0}</span>
          </button>
        ))
      )}
    </Modal>
  )
}
