import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadMemories } from '../../services/chat/memoryRead.js'
import { countLocalMemories } from '../../services/chat/memoryStore.js'
import { setMemoryServiceToken, setMemoryServiceUrl, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './MemoryServiceSetting.module.css'

/**
 * 记忆的存放位置。默认就是本机——装上就能用，不需要填任何东西。
 * 连自己那台服务是可选的高级项，收起来，免得每个新用户都以为要先配一遍。
 */
export const MemoryServiceSetting = () => {
  const t = useTranslate()
  const url = useSettings((state) => state.memoryServiceUrl)
  const token = useSettings((state) => state.memoryServiceToken)
  const [open, setOpen] = useState(Boolean(url || token))
  const [testing, setTesting] = useState(false)
  const [localCount, setLocalCount] = useState<number | null>(null)

  // 本地条数用来给「本机」这条一个实证：不是空口说存在这里
  useEffect(() => {
    let alive = true
    void countLocalMemories()
      .then((count) => {
        if (alive) {
          setLocalCount(count)
        }
      })
      .catch(() => {
        if (alive) {
          setLocalCount(null)
        }
      })
    return () => {
      alive = false
    }
  }, [])

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
      <div className={styles.field}>
        <span className={styles.label}>{t('memoryServiceTitle')}</span>
        <p className={styles.hint}>
          <strong>{t('memoryServiceLocal')}</strong>
          {localCount === null ? '' : ` · ${t('memoryPanelTotal', { count: localCount })}`}
        </p>
        <p className={styles.hint}>{t('memoryServiceLocalHint')}</p>
      </div>
      <div className={styles.field}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          <span>{t('memoryServiceRemote')}</span>
        </button>
        {open ? null : <p className={styles.hint}>{t('memoryServiceRemoteHint')}</p>}
      </div>
      {open ? (
        <>
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
        </>
      ) : null}
    </div>
  )
}
