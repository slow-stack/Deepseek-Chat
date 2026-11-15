import type { ComponentType, ReactNode } from 'react'
import type { TranslationKey } from '../i18n/index.js'

/**
 * 一个可插拔页面。
 *
 * 语义：开关关着时这个插件**不注册**——侧栏没有入口、主区域打不开它、
 * 聊天里也不长它带来的按钮；打开后才整套出现，像装了一个插件而不是
 * 藏起来一页功能。所以插件自己的所有入口都从这里拿 enabled 判断，
 * 不要在组件里各写一份开关。
 */
export type AppPlugin = {
  id: string
  /** 侧栏入口与设置里显示的名字 */
  title: TranslationKey
  /** 一句话说明它做什么，写在设置·插件的清单里 */
  description: TranslationKey
  icon: ReactNode
  /** 打开后占满主区域的整页内容 */
  Page: ComponentType
  /** 启用后展开的配置块（服务地址之类）；没有就只留开关 */
  Settings?: ComponentType
}