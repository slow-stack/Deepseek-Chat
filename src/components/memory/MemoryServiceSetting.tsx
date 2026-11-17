import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { isCleartextBlocked, isCleartextFailure } from '../../services/chat/memoryEndpoint.js'
import { loadMemories } from '../../services/chat/memoryRead.js'
import { countLocalMemories } from '../../services/chat/memoryStore.js'
import { reindexMemories, resetVectors, vectorReady } from '../../services/chat/memoryVector.js'
import {
  setMemoryAutoDigest,
  setMemoryAutoDigestBatch,
  setMemoryAutoDigestHours,
  setMemoryServiceToken,
  setMemoryServiceUrl,
  setMemoryVectorApiKey,
  setMemoryVectorBaseUrl,
  setMemoryVectorEnabled,
  setMemoryVectorModel,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './MemoryServiceSetting.module.css'

/**
 * 记忆的存放位置。默认就是本机——装上就能用，不需要填任何东西。
 * 连自己那台服务、开向量检索都是可选的高级项，都收起来，
 * 免得每个新用户都以为要先配一遍。
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
    } catch (error) {
      // 明文被系统拦下时，说「服务坏了」会把人引向错误方向——直接告诉他换 https
      if (isCleartextFailure(error)) {
        showToast({ key: 'memoryServiceCleartextBlocked', type: 'error' })
      } else {
        showToast({ key: 'memoryServiceUnreachable', type: 'error' })
      }
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
              placeholder="https://memory.example.com"
              aria-label={t('memoryServiceUrlLabel')}
              onBlur={(event) => setMemoryServiceUrl(event.target.value)}
            />
            <span className={styles.hint}>{t('memoryServiceUrlHint')}</span>
            {url && isCleartextBlocked(url) ? (
              <span className={styles.warn}>{t('memoryServiceCleartextHint')}</span>
            ) : null}
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
      <AutoDigest />
      <VectorSetting />
    </div>
  )
}

const HOURS_OPTIONS = [1, 3, 6, 12, 24, 48, 72]
const BATCH_OPTIONS = [1, 3, 5, 10, 20]

/**
 * 自动整理：打开应用时把没整理过的会话沉淀成记忆。
 * 默认开——否则导入了一堆会话，用户不按按钮它们永远只是干躺在列表里。
 */
const AutoDigest = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.memoryAutoDigest)
  const hours = useSettings((state) => state.memoryAutoDigestHours)
  const batch = useSettings((state) => state.memoryAutoDigestBatch)
  return (
    <>
      <div className={styles.field}>
        <span className={styles.label}>{t('memoryAutoDigestTitle')}</span>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setMemoryAutoDigest(event.target.checked)}
          />
          <span>{t('memoryAutoDigestLabel')}</span>
        </label>
        <span className={styles.hint}>{t('memoryAutoDigestHint')}</span>
      </div>
      {enabled ? (
        <>
          <div className={styles.field}>
            <span className={styles.label}>{t('memoryAutoDigestHoursLabel')}</span>
            <Select
              ariaLabel={t('memoryAutoDigestHoursLabel')}
              value={String(hours)}
              options={HOURS_OPTIONS.map((value) => ({
                value: String(value),
                label: t('memoryAutoDigestHoursValue', { hours: value }),
              }))}
              onChange={(value) => setMemoryAutoDigestHours(Number(value))}
            />
            <span className={styles.hint}>{t('memoryAutoDigestHoursHint')}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('memoryAutoDigestBatchLabel')}</span>
            <Select
              ariaLabel={t('memoryAutoDigestBatchLabel')}
              value={String(batch)}
              options={BATCH_OPTIONS.map((value) => ({
                value: String(value),
                label: t('memoryAutoDigestBatchValue', { count: value }),
              }))}
              onChange={(value) => setMemoryAutoDigestBatch(Number(value))}
            />
            <span className={styles.hint}>{t('memoryAutoDigestBatchHint')}</span>
          </div>
        </>
      ) : null}
    </>
  )
}

/**
 * 向量检索：可选、默认关。开了才有「按意思搜」，没开就是字面匹配。
 * 地址/模型/密钥都存本机，别指望用户去跑一个后端。
 */
const VectorSetting = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.memoryVectorEnabled)
  const baseUrl = useSettings((state) => state.memoryVectorBaseUrl)
  const model = useSettings((state) => state.memoryVectorModel)
  const apiKey = useSettings((state) => state.memoryVectorApiKey)
  const [open, setOpen] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const ready = vectorReady()

  const rebuild = async () => {
    setBusy(true)
    setProgress(null)
    try {
      const result = await reindexMemories(undefined, (done, total) => {
        setProgress(t('memoryVectorReindexProgress', { done, total }))
      })
      if (result.failed > 0) {
        showToast({
          key: 'memoryVectorReindexFailed',
          params: { reason: result.failure ?? t('memoryVectorReindexNoReason') },
          type: 'error',
        })
      } else {
        showToast({
          key: 'memoryVectorReindexDone',
          params: { indexed: result.indexed, skipped: result.skipped },
        })
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const clear = async () => {
    await resetVectors()
    showToast({ key: 'memoryVectorResetDone' })
  }

  return (
    <>
      <div className={styles.field}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          <span>{t('memoryVectorTitle')}</span>
        </button>
        {open ? null : <p className={styles.hint}>{t('memoryVectorHint')}</p>}
      </div>
      {open ? (
        <>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setMemoryVectorEnabled(event.target.checked)}
            />
            <span>{t('memoryVectorEnabledLabel')}</span>
          </label>
          <p className={styles.hint}>{t('memoryVectorHint')}</p>
          <label className={styles.field}>
            <span className={styles.label}>{t('memoryVectorBaseUrlLabel')}</span>
            <input
              className={styles.input}
              defaultValue={baseUrl}
              placeholder="https://api.siliconflow.cn/v1"
              aria-label={t('memoryVectorBaseUrlLabel')}
              onBlur={(event) => setMemoryVectorBaseUrl(event.target.value)}
            />
            <span className={styles.hint}>{t('memoryVectorBaseUrlHint')}</span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('memoryVectorModelLabel')}</span>
            <input
              className={styles.input}
              defaultValue={model}
              placeholder="BAAI/bge-m3"
              aria-label={t('memoryVectorModelLabel')}
              onBlur={(event) => setMemoryVectorModel(event.target.value)}
            />
            <span className={styles.hint}>{t('memoryVectorModelHint')}</span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('memoryVectorApiKeyLabel')}</span>
            <input
              className={styles.input}
              type="password"
              defaultValue={apiKey}
              aria-label={t('memoryVectorApiKeyLabel')}
              onBlur={(event) => setMemoryVectorApiKey(event.target.value)}
            />
            <span className={styles.hint}>{t('memoryVectorApiKeyHint')}</span>
          </label>
          <div className={styles.actions}>
            <Button variant="outlined" size="m" disabled={busy || !ready} onClick={() => void rebuild()}>
              {t(busy ? 'memoryVectorReindexing' : 'memoryVectorReindex')}
            </Button>
            <Button variant="outlined" size="m" disabled={busy} onClick={() => void clear()}>
              {t('memoryVectorReset')}
            </Button>
          </div>
          {ready ? null : <p className={styles.hint}>{t('memoryVectorNotReady')}</p>}
          {progress ? <p className={styles.hint}>{progress}</p> : null}
        </>
      ) : null}
    </>
  )
}
