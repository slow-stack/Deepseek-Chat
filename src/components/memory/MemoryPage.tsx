import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconRefreshOutline16 } from '../base/icons.js'
import { MobileHeader } from '../session/MobileHeader.js'
import { DigestDialog } from './DigestDialog.js'
import { MemoryBrowser } from './MemoryPanel.js'
import styles from './MemoryPage.module.css'

/**
 * 记忆页：插件打开后占满主区域的一整页。
 * 桌面端顶部是标题与一句说明；移动端让开顶栏，标题交给顶栏显示。
 *
 * 「整理历史会话」在两处的位置不同但含义一致：
 * 桌面是标题右侧的按钮，移动端是顶栏最右边那个图标——
 * 顶栏右侧本来就是「新对话」，在记忆页这个位置上更该做的是整理，所以换成它。
 */
export const MemoryPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [digesting, setDigesting] = useState(false)
  // 整理完会往库里写东西，关掉弹窗时让列表重读一次
  const [refreshKey, setRefreshKey] = useState(0)
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
