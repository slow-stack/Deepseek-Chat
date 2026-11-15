import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { isMemoryEnabled } from '../../services/chat/memory.js'
import { setMemoryEnabled } from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { ContextChip } from './ContextChip.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话级记忆开关：关掉的会话永不进记忆库，也不从记忆库取上下文 */
const MemoryChip = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const enabled = isMemoryEnabled(session)
  const label = enabled ? t('memoryOn') : t('memoryOff')
  return (
    <button
      type="button"
      className={clsx(styles.memoryChip, !enabled && styles.memoryOff)}
      aria-label={label}
      aria-pressed={enabled}
      title={enabled ? t('memoryOnHint') : t('memoryOffHint')}
      onClick={() => setMemoryEnabled(session.id, !enabled)}
    >
      {label}
    </button>
  )
}

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  /** 记忆开关与上下文占用并排右对齐 */
  const chips = (
    <>
      <ContextChip session={session} />
      <MemoryChip session={session} />
    </>
  )
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} trailing={chips} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.chips}>{chips}</div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}