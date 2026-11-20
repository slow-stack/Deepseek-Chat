import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { HistoryProgress } from '../components/base/HistoryProgress.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { UpdateDialog } from '../components/sider/UpdateDialog.js'
import { runUpdateCheck } from '../components/sider/updateBannerState.js'
import { autoDigest } from '../services/chat/memoryDigest.js'
import { useEnabledPlugins } from '../plugins/registry.js'
import { openChatPage, useAppPage } from './pageState.js'
import { dismissBootSplash } from './bootSplash.js'
import { clearFatalScreen } from './fatalScreen.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  // 主区域也可以是插件页；插件关掉后自动退回对话
  const plugins = useEnabledPlugins()
  const page = useAppPage((state) => state.page)
  const activePlugin = page === 'chat' ? null : (plugins.find((item) => item.id === page) ?? null)
  const ActivePluginPage = activePlugin?.Page

  usePreventPageScroll(isMobile)

  // 面板嵌在宿主 iframe 里时，宿主可能在顶部画自己的标签/工具栏；留出一条安全边
  useEffect(() => {
    document.documentElement.dataset.embedded = String(window.self !== window.top)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  // 选会话、开新对话都回到对话页
  useEffect(openChatPage, [activeId])
  // 插件被关掉（或这一页已经不存在）时退回对话，不留一页打不开的空白
  useEffect(() => {
    if (page !== 'chat' && !activePlugin) {
      openChatPage()
    }
  }, [page, activePlugin])

  useEffect(() => {
    void initChat()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  // 进页面顺手问一次更新，问不到就算了，不打扰用户。
  // 放在 App 而不是侧栏里：侧栏收起或移动端抽屉关着时也要能提示。
  useEffect(() => {
    void runUpdateCheck()
  }, [])

  // 打开应用时补一段自动整理：导入过的会话不能永远躺在列表里等人按按钮。
  // 等 chat 初始化完再跑——它要读会话表；跑在后台，失败也不弹窗。
  // 手机上没人会主动退出应用，切走再回来是最常见的「下次打开」，所以回到前台
  // 也要再问一次；间隔由 autoDigest 内部的 gap 挡，回前台再频繁也不会重复整理。
  useEffect(() => {
    if (!ready) {
      return
    }
    void autoDigest().catch(() => {})
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void autoDigest().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [ready])

  // 开屏动画（index.html 里的 #boot-splash）等会话就绪或初始化失败时让位；
  // 它自己还有超时兜底，这里只负责正常路径。
  useEffect(() => {
    if (ready || initError) {
      dismissBootSplash()
      // 告诉兜底逻辑「App 已经跑起来了」：此后零星的异步报错走局部提示，
      // 不该再把整页盖成错误页。index.html 的内联兜底也读这个标记。
      window.__dsAppMounted = true
      // 启动早期可能已经有报错先占了屏（那种报错未必致命），App 真起来了就撤掉。
      clearFatalScreen()
    }
  }, [ready, initError])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {ActivePluginPage ? (
              <ActivePluginPage />
            ) : !ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <UpdateDialog />
      <HistoryProgress />
      <Toast />
    </>
  )
}
