import type { ReactNode } from 'react'
import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { openChatPage } from '../../app/pageState.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/**
 * 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题、附加控件与右侧按钮。
 *
 * 右侧默认是「新对话」。这里必须和新对话入口的别处保持一致：先 newChat 再 openChatPage。
 * 只调 newChat 时，若 activeId 已经是 null（刚进 App、还没选过会话），store 里
 * 值没变，App 那个 useEffect(openChatPage, [activeId]) 就不会触发，于是人在插件页
 * 点加号毫无反应。
 */
export const MobileHeader = ({
  title,
  trailing,
  action,
}: {
  title?: string
  trailing?: ReactNode
  /** 右侧按钮，默认「新对话」；记忆页换成「整理历史会话」 */
  action?: ReactNode
}) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <>
          <div className={styles.title}>{title}</div>
          {trailing}
          {action ?? (
            <IconButton
              size="xl"
              tone="primary"
              icon={<IconNewChatOutline20 />}
              aria-label={t('newChat')}
              onClick={() => {
                newChat()
                openChatPage()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
