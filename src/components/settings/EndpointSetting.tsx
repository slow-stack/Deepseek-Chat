import { useState } from 'react'
import { API_ORIGIN } from '../../services/api/client.js'
import { CAPABILITIES_WITH_MODEL, type ApiCapability } from '../../services/api/capability.js'
import {
  setEndpointOverride,
  useSettings,
  type EndpointOverride,
} from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import type { TranslationKey } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '../base/icons.js'
import styles from './EndpointSetting.module.css'

/** 每条能力在界面上的名字与说明键 */
const LABELS: Record<ApiCapability, { title: TranslationKey; description: TranslationKey }> = {
  chat: { title: 'endpointChatTitle', description: 'endpointChatDescription' },
  summary: { title: 'endpointSummaryTitle', description: 'endpointSummaryDescription' },
  search: { title: 'endpointSearchTitle', description: 'endpointSearchDescription' },
  tts: { title: 'endpointTtsTitle', description: 'endpointTtsDescription' },
  asr: { title: 'endpointAsrTitle', description: 'endpointAsrDescription' },
}

/** 未配置时实际生效的默认值，写出来才看得出来「留空」意味着什么 */
const describeDefault = (capability: ApiCapability, t: ReturnType<typeof useTranslate>) => {
  const hasModel = CAPABILITIES_WITH_MODEL.includes(capability)
  return hasModel
    ? t('endpointDefaultWithModel', { origin: API_ORIGIN })
    : t('endpointDefault', { origin: API_ORIGIN })
}

/**
 * 分接口设置：把对话、摘要、语音拆到不同服务上，
 * 每条都可以只改地址、只改密钥或只改模型，留空的字段跟随主接口。
 */
export const EndpointSetting = () => {
  const t = useTranslate()
  return (
    <>
      <p className={styles.intro}>{t('endpointsIntro')}</p>
      {Object.keys(LABELS).map((key) => (
        <EndpointRow key={key} capability={key as ApiCapability} t={t} />
      ))}
    </>
  )
}

const EndpointRow = ({
  capability,
  t,
}: {
  capability: ApiCapability
  t: ReturnType<typeof useTranslate>
}) => {
  const override = useSettings((state) => state.endpoints[capability])
  const [collapsed, setCollapsed] = useState(true)
  const label = LABELS[capability]
  const configured = Boolean(override.baseUrl || override.apiKey || override.model)

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className={styles.chevron}>
          {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
        </span>
        <span className={styles.texts}>
          <span className={styles.title}>
            {t(label.title)}
            {configured ? <span className={styles.badge}>{t('endpointCustomized')}</span> : null}
          </span>
          <span className={styles.description}>
            {configured ? describeSummary(override, t) : describeDefault(capability, t)}
          </span>
        </span>
      </button>
      {collapsed ? null : (
        <div className={styles.fields}>
          <Field
            key={`baseUrl-${override.baseUrl}`}
            label={t('endpointBaseUrlLabel')}
            hint={t('endpointBaseUrlHint')}
            value={override.baseUrl}
            placeholder={API_ORIGIN}
            onCommit={(value) => setEndpointOverride(capability, { baseUrl: value })}
          />
          <Field
            key={`apiKey-${override.apiKey}`}
            label={t('endpointApiKeyLabel')}
            hint={t('endpointApiKeyHint')}
            value={override.apiKey}
            type="password"
            placeholder={t('endpointApiKeyPlaceholder')}
            onCommit={(value) => setEndpointOverride(capability, { apiKey: value })}
          />
          {CAPABILITIES_WITH_MODEL.includes(capability) ? (
            <Field
              key={`model-${override.model}`}
              label={t('endpointModelLabel')}
              hint={t('endpointModelHint')}
              value={override.model}
              placeholder="deepseek-flash"
              onCommit={(value) => setEndpointOverride(capability, { model: value })}
            />
          ) : null}
          {configured ? (
            <div>
              <Button
                variant="outlined"
                size="s"
                onClick={() => setEndpointOverride(capability, { baseUrl: '', apiKey: '', model: '' })}
              >
                {t('endpointReset')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** 配过之后把实际生效的组合写清楚：改了什么、剩下的从哪来 */
const describeSummary = (override: EndpointOverride, t: ReturnType<typeof useTranslate>) => {
  const parts: string[] = [override.baseUrl || t('endpointFollowMain')]
  parts.push(override.apiKey ? t('endpointOwnKey') : t('endpointFollowKey'))
  if (override.model) {
    parts.push(override.model)
  }
  return parts.join(' · ')
}

const Field = ({
  label,
  hint,
  value,
  placeholder,
  type,
  onCommit,
}: {
  label: string
  hint: string
  value: string
  placeholder?: string
  type?: 'password'
  onCommit: (value: string) => void
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <input
      className={styles.input}
      defaultValue={value}
      placeholder={placeholder}
      type={type ?? 'text'}
      aria-label={label}
      onBlur={(event) => onCommit(event.target.value)}
    />
    <span className={styles.hint}>{hint}</span>
  </label>
)