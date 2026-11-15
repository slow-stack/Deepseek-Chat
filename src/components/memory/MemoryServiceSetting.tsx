import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadMemories } from '../../services/chat/memoryRead.js'
import { setMemoryServiceToken, setMemoryServiceUrl, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './MemoryServiceSetting.module.css'

/**
 * 记忆服务的连接配置：地址 + token。
 * 地址留空时走宿主代转（只在 DSH 面板里有效）；填了就是直连，APK 只能直连。
 */
export const MemoryServiceSetting = () => {
  const t = useTranslate()
  const url = useSettings((state) => state.memoryServiceUrl)
  const token = useSettings((state) => state.memoryServiceToken)
  const [testing, setTesting] = useState(false)

  // 测一次读接口：能读到就算通，读不到把原因说清楚
  const test = async () => {
    setTesting(true)
    try {
      await loadMemories({ limit: 1 })
      showToast({ key: 'memoryServiceReachable' })
    } catch {
      showToast({ key: 'memoryServiceUnreachable', type: 'error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={styles.block}>
      <label className={styles.field}>
        <span className={styles.label}>{t('memoryServiceUrlLabel')}</span>
        <input
          className={styles.input}
          defaultValue={url ?? ''}
          placeholder="http://192.168.0.101:8790"
          aria-label={t('memoryServiceUrlLabel')}
          onBlur={(event) => setMemoryServiceUrl(event.target.value)}
        />
        <span className={styles.hint}>{t('memoryServiceUrlHint')}</span>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('memoryServiceTokenLabel')}</span>
        <input
          className={styles.input}
          type="password"
          defaultValue={token ?? ''}
          aria-label={t('memoryServiceTokenLabel')}
          onBlur={(event) => setMemoryServiceToken(event.target.value)}
        />
        <span className={styles.hint}>{t('memoryServiceTokenHint')}</span>
      </label>
      <div>
        <Button variant="outlined" size="m" disabled={testing} onClick={() => void test()}>
          {t(testing ? 'memoryServiceTesting' : 'memoryServiceTest')}
        </Button>
      </div>
    </div>
  )
}