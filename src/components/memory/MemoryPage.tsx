import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { MobileHeader } from '../session/MobileHeader.js'
import { MemoryBrowser } from './MemoryPanel.js'
import styles from './MemoryPage.module.css'

/**
 * 记忆页：插件打开后占满主区域的一整页。
 * 桌面端顶部是标题与一句说明；移动端让开顶栏，标题交给顶栏显示。
 */
export const MemoryPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.page}>
      {isMobile ? <MobileHeader title={t('memoryPanelTitle')} /> : null}
      <div className={styles.column}>
        {isMobile ? null : (
          <header className={styles.head}>
            <h1 className={styles.title}>{t('memoryPanelTitle')}</h1>
            <p className={styles.subtitle}>{t('memoryPageSubtitle')}</p>
          </header>
        )}
        <MemoryBrowser variant="page" />
      </div>
    </div>
  )
}