import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { Button } from '../base/Button.js'
import { MobileHeader } from '../session/MobileHeader.js'
import { DigestDialog } from './DigestDialog.js'
import { MemoryBrowser } from './MemoryPanel.js'
import styles from './MemoryPage.module.css'

/**
 * 记忆页：插件打开后占满主区域的一整页。
 * 桌面端顶部是标题与一句说明；移动端让开顶栏，标题交给顶栏显示。
 *
 * 右上角那个按钮是「整理历史会话」：导入一堆会话之后，
 * 记忆页本来只能一条条看，得有个地方把它们批量变成记忆。
 */
export const MemoryPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [digesting, setDigesting] = useState(false)
  // 整理完会往库里写东西，关掉弹窗时让列表重读一次
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className={styles.page}>
      {isMobile ? <MobileHeader title={t('memoryPanelTitle')} /> : null}
      <div className={styles.column}>
        <header className={styles.head}>
          <div className={styles.headMain}>
            {isMobile ? null : <h1 className={styles.title}>{t('memoryPanelTitle')}</h1>}
            {isMobile ? null : <p className={styles.subtitle}>{t('memoryPageSubtitle')}</p>}
          </div>
          <Button variant="outlined" size="m" onClick={() => setDigesting(true)}>
            {t('memoryDigestOpen')}
          </Button>
        </header>
        <MemoryBrowser variant="page" refreshKey={refreshKey} />
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