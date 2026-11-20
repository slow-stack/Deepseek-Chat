import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { showFatalScreen } from './fatalScreen.js'

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * 最外层的渲染兜底。
 *
 * react 的 ErrorBoundary 只能接住「渲染期」的异常；事件处理、异步里的异常走 fatalScreen 那边
 * 的 window 监听。两者都覆盖不到的是「包压根没下载」——那由 index.html 的内联脚本管。
 * 三道加起来的目标只有一个：任何情况下用户都不该对着一片白猜发生了什么。
 *
 * 这里刻意不自己画界面，而是复用 fatalScreen 的那一套：样式、文案、按钮只该有一份，
 * 崩溃时再多引入一个渲染路径只会多一个出错机会。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail = [error?.stack || String(error), info?.componentStack].filter(Boolean).join('\n')
    showFatalScreen({ detail })
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return null
    }
    return this.props.children
  }
}
