/**
 * 桌面图标：内置五套，切的是 Android 的 activity-alias。
 *
 * Android 没有「运行时换启动图标」的接口，标准做法是清单里预先登记几个
 * 别名（各自带一个 icon），运行时只启停这些别名，启用的那个就是桌面上的图标。
 * 原生侧实现在 android/app/src/main/java/com/slowstack/deepseekchat/LauncherIconPlugin.java。
 *
 * 两个注意点：
 *   - 切完系统会重建桌面快捷方式，应用通常被杀一次，所以调用方要提示「可能要重新打开」。
 *   - 网页里没有这个插件，available() 为 false，设置项整块隐藏。
 */

import type { AppIcon } from './settings.js'

/** 插件在 window.Capacitor.Plugins 下的名字，必须与 @CapacitorPlugin(name = ...) 一致 */
const PLUGIN_NAME = 'LauncherIcon'

type LauncherIconPlugin = {
  get: () => Promise<{ icon?: string }>
  set: (options: { icon: string }) => Promise<{ icon?: string }>
}

const plugin = (): LauncherIconPlugin | null => {
  const capacitor = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
  const found = capacitor?.Plugins?.[PLUGIN_NAME]
  return found ? (found as LauncherIconPlugin) : null
}

/** 装成 App 才有图标可换；网页里没有这个插件 */
export const canChangeAppIcon = (): boolean => plugin() !== null

/** 读当前生效的图标；读不到（比如从旧版本升级上来还没切过）返回 null */
export const readAppIcon = async (): Promise<AppIcon | null> => {
  const found = plugin()
  if (!found) {
    return null
  }
  try {
    const result = await found.get()
    return toAppIcon(result.icon)
  } catch {
    return null
  }
}

/**
 * 换图标。成功返回 true；插件不在或系统拒绝都返回 false，由调用方决定怎么提示。
 * 原生侧先启用目标别名再关掉其余，所以中途不会出现「一个入口都没有」。
 */
export const writeAppIcon = async (icon: AppIcon): Promise<boolean> => {
  const found = plugin()
  if (!found) {
    return false
  }
  try {
    await found.set({ icon })
    return true
  } catch {
    return false
  }
}

const toAppIcon = (value: unknown): AppIcon | null =>
  value === 'v1' || value === 'v2' || value === 'v3' || value === 'v4' || value === 'v5' ? value : null
