import { useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 按当下时间挑问候词：像手机和网页端那样，几点说几的话 */
const greetingKey = (hour: number): 'welcomeMorning' | 'welcomeAfternoon' | 'welcomeEvening' | 'welcomeNight' => {
  if (hour >= 5 && hour < 12) {
    return 'welcomeMorning'
  }
  if (hour >= 12 && hour < 18) {
    return 'welcomeAfternoon'
  }
  if (hour >= 18 && hour < 23) {
    return 'welcomeEvening'
  }
  return 'welcomeNight'
}

/** 问候后面接的那句话，从这堆里随机抽一个，免得每次进来都一样；
 *  「欢迎回来」这类自带场景的句子单独成句，前面不再拼时段问候 */
const followUpKeys = [
  'welcomeFollowHelp1',
  'welcomeFollowHelp2',
  'welcomeFollowChat',
  'welcomeFollowBack1',
  'welcomeFollowBack2',
] as const

/** 接句是「欢迎回来」类时，时段问候让位：单独一句比拼在一起自然 */
const standaloneFollowUps: ReadonlySet<string> = new Set(['welcomeFollowBack1', 'welcomeFollowBack2'])

const pickFollowUp = (): (typeof followUpKeys)[number] => {
  return followUpKeys[Math.floor(Math.random() * followUpKeys.length)]
}

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 组件挂载时取一次就够：欢迎页停留不过夜，不必挂着定时器轮换
  const [lines] = useState<[string, string]>(() => {
    const followUp = pickFollowUp()
    // 欢迎回来不叠问候词，「上午好，欢迎回来」读着别扭
    if (standaloneFollowUps.has(followUp)) {
      return ['', t(followUp)]
    }
    return [t(greetingKey(new Date().getHours())), t(followUp)]
  })
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>
          {lines[0] ? `${lines[0]}，` : ''}
          {lines[1]}
        </div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
