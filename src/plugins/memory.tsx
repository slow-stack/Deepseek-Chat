import { IconBrainOutline16 } from '../components/base/icons.js'
import { MemoryPage } from '../components/memory/MemoryPage.js'
import { MemoryServiceSetting } from '../components/memory/MemoryServiceSetting.js'
import type { AppPlugin } from './types.js'

/** 记忆插件：把 mneme 记忆服务接成一个独立页面，关掉就跟没装一样 */
export const MEMORY_PLUGIN_ID = 'memory'

export const memoryPlugin: AppPlugin = {
  id: MEMORY_PLUGIN_ID,
  title: 'memoryPanelTitle',
  description: 'memoryPluginDescription',
  icon: <IconBrainOutline16 />,
  Page: MemoryPage,
  Settings: MemoryServiceSetting,
}