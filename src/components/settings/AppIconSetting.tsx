import { useCallback, useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { canChangeAppIcon, readAppIcon, writeAppIcon } from '../../services/appIcon.js'
import { setAppIcon, useSettings, type AppIcon } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

const BG = '#FAF9F6'
const INK = '#1F2328'
const ACC = '#3964FE'

/** 尾巴统一往左下斜的尖角；垂直那一笔看着像多了一条线，已经不用了 */
const TAIL_FILL = 'M46 69 L33 86 L58 69 Z'
const TAIL_LINE = 'M45 68.5 L34.5 84.5'

/**
 * 五套图标的矢量形状，与 Android 侧的 mipmap 同一份几何（viewBox 0 0 108 108）。
 * 这里内联画一遍而不是加载位图：rspack 没配图片 loader，且预览要跟系统缩放无关。
 */
const GLYPHS: Record<AppIcon, ReactNode> = {
  v1: (
    <>
      <rect x="24" y="28" width="60" height="42" rx="14" fill="none" stroke={INK} strokeWidth="7.5" />
      <path d={TAIL_LINE} fill="none" stroke={INK} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M40 45 H70" stroke={INK} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M40 57 H57" stroke={ACC} strokeWidth="6.5" strokeLinecap="round" />
    </>
  ),
  v2: (
    <>
      <rect x="24" y="28" width="60" height="42" rx="14" fill={INK} />
      <path d={TAIL_FILL} fill={INK} />
      <path d="M40 45 H70" stroke={BG} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M40 57 H57" stroke={ACC} strokeWidth="6.5" strokeLinecap="round" />
    </>
  ),
  v3: (
    <>
      <rect
        x="38"
        y="26"
        width="44"
        height="32"
        rx="11"
        fill="none"
        stroke={INK}
        strokeWidth="6"
        opacity="0.35"
      />
      <rect x="26" y="42" width="50" height="32" rx="12" fill={BG} stroke={INK} strokeWidth="7" />
      <path
        d="M44 72 L35 86 L56 72"
        fill="none"
        stroke={INK}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="58" cy="58" r="6" fill={ACC} />
    </>
  ),
  v4: (
    <>
      <path d="M36 34 V74" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <path
        d="M36 34 H54 A20 20 0 0 1 54 74 H36"
        fill="none"
        stroke={INK}
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <path d="M36 54 H50" stroke={ACC} strokeWidth="8" strokeLinecap="round" />
    </>
  ),
  v5: (
    <>
      <path d="M28 40 H80" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <path d="M28 54 H68" stroke={INK} strokeWidth="8" strokeLinecap="round" opacity="0.6" />
      <path d="M28 68 H52" stroke={ACC} strokeWidth="8" strokeLinecap="round" />
    </>
  ),
}

const ICON_OPTIONS: { value: AppIcon; label: 'settingDialogAppIconV1' | 'settingDialogAppIconV2' | 'settingDialogAppIconV3' | 'settingDialogAppIconV4' | 'settingDialogAppIconV5' }[] = [
  { value: 'v1', label: 'settingDialogAppIconV1' },
  { value: 'v2', label: 'settingDialogAppIconV2' },
  { value: 'v3', label: 'settingDialogAppIconV3' },
  { value: 'v4', label: 'settingDialogAppIconV4' },
  { value: 'v5', label: 'settingDialogAppIconV5' },
]

/** 一个小预览：圆角底 + 图形，尺寸跟设置里的按钮走 */
const IconPreview = ({ icon }: { icon: AppIcon }) => (
  <svg className={styles.iconPreview} viewBox="0 0 108 108" aria-hidden="true">
    <rect width="108" height="108" rx="26" fill={BG} />
    {GLYPHS[icon]}
  </svg>
)

/**
 * 桌面图标：内置五套，切的是 Android 的 activity-alias。
 *
 * 只在装成 App 时出现——网页里没有原生插件，也就没有图标可换。
 * 切完系统会重建桌面快捷方式，应用可能被重开一次，所以提示里要说清。
 */
const AppIconSetting = () => {
  const t = useTranslate()
  const stored = useSettings((state) => state.appIcon)
  const [current, setCurrent] = useState<AppIcon | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // 打开设置时问一下系统当前用的是哪套：本地存的只是「上次点过什么」，
  // 用户可能在别处改过（重装、恢复备份），以系统为准。
  useEffect(() => {
    let alive = true
    void readAppIcon().then((icon) => {
      if (alive && icon) {
        setCurrent(icon)
        setAppIcon(icon)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const pick = useCallback(
    async (icon: AppIcon) => {
      if (busy || icon === current) {
        return
      }
      setBusy(true)
      setFailed(false)
      const ok = await writeAppIcon(icon)
      if (ok) {
        setCurrent(icon)
        setAppIcon(icon)
      } else {
        setFailed(true)
      }
      setBusy(false)
    },
    [busy, current]
  )

  if (!canChangeAppIcon()) {
    return null
  }

  const selected = current ?? stored
  const label = t('settingDialogAppIconItemLabel')

  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.iconOptions}>
        {ICON_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected === option.value}
            disabled={busy}
            className={clsx(styles.iconOption, selected === option.value && styles.iconOptionSelected)}
            onClick={() => void pick(option.value)}
          >
            <IconPreview icon={option.value} />
            {t(option.label)}
          </button>
        ))}
      </div>
      <p className={clsx(styles.themeHint, failed && styles.error)}>
        {failed ? t('settingDialogAppIconFailed') : t('settingDialogAppIconHint')}
      </p>
    </div>
  )
}

export { AppIconSetting }
