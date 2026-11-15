import { create } from 'zustand'
import { checkForUpdate, dismissUpdate, type AvailableUpdate } from '../../services/update.js'

type UpdateBannerState = {
  /** 待提示的新版本；null 表示没有 */
  update: AvailableUpdate | null
  /** 正在向远端确认，手动检查时用来禁用按钮 */
  checking: boolean
  /** 最近一次检查的结论，设置页用它反馈：null 表示本次会话还没查过 */
  lastResult: 'latest' | 'unreachable' | null
}

const initial: UpdateBannerState = { update: null, checking: false, lastResult: null }

export const useUpdateBanner = create<UpdateBannerState>(() => ({ ...initial }))

/**
 * 查一次更新。force=true 用于设置页的手动检查（绕过节流，并把结论说清楚）。
 * 自动检查失败不打扰用户。
 */
export const runUpdateCheck = async ({ force = false } = {}) => {
  if (useUpdateBanner.getState().checking) {
    return
  }
  useUpdateBanner.setState({ checking: true })
  try {
    const result = await checkForUpdate({ force })
    if (result.status === 'newer') {
      useUpdateBanner.setState({ update: result.update, lastResult: 'latest' })
      return
    }
    if (result.status === 'latest') {
      useUpdateBanner.setState({ update: null, lastResult: 'latest' })
      return
    }
    if (result.status === 'unreachable' && force) {
      useUpdateBanner.setState({ lastResult: 'unreachable' })
    }
  } finally {
    useUpdateBanner.setState({ checking: false })
  }
}

export const closeUpdateBanner = () => {
  const update = useUpdateBanner.getState().update
  if (update) {
    dismissUpdate(update.versionName)
  }
  useUpdateBanner.setState({ update: null })
}