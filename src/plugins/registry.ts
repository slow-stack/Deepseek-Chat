import { useMemo } from 'react'
import { setMemoryPluginEnabled, useSettings } from '../services/settings.js'
import { MEMORY_PLUGIN_ID, memoryPlugin } from './memory.js'
import type { AppPlugin } from './types.js'

/** 全部已安装的插件。加插件就在这里加一行，开关另在 settings 里落一个字段 */
export const PLUGINS: AppPlugin[] = [memoryPlugin]

/**
 * 已启用插件的 id，拼成字符串给 zustand 订阅。
 * 不能返回数组/对象：每次都是新引用，会让订阅方一直重渲染。
 */
export const enabledPluginIds = (state: { memoryPluginEnabled: boolean }): string =>
  state.memoryPluginEnabled ? MEMORY_PLUGIN_ID : ''

/** 已启用的插件；关掉的不注册，侧栏没有入口、页面打不开 */
export const useEnabledPlugins = (): AppPlugin[] => {
  const ids = useSettings(enabledPluginIds)
  return useMemo(() => {
    const on = new Set(ids.split(',').filter(Boolean))
    return PLUGINS.filter((plugin) => on.has(plugin.id))
  }, [ids])
}

/** 单个插件是否启用：聊天输入框这类单点入口用它 */
export const usePluginEnabled = (id: string): boolean =>
  useSettings(enabledPluginIds)
    .split(',')
    .includes(id)

/** 开关一个插件。插件多了就在这里按 id 分发到各自的设置字段 */
export const setPluginEnabled = (id: string, enabled: boolean) => {
  if (id === MEMORY_PLUGIN_ID) {
    setMemoryPluginEnabled(enabled)
  }
}