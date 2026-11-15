/**
 * 面板嵌在宿主 iframe 里时的那条「出口」。
 *
 * 宿主把这一页放进自己的主面板后，界面上没有留下任何回会话的控件 —— 点侧栏底部入口进来，
 * 就再也找不到出去的地方（桉桉 2026-11-15：「进去了没出来的入口啊」）。
 * 所以嵌进来时我们自己画一个返回键：它只往宿主发一条消息，由宿主的插件把主面板切回会话。
 * 单独打开（127.0.0.1:8096）时这个键不出现，因为它出去没有意义。
 */
const LEAVE_MESSAGE = 'dsh-chat-demo:leave'

/** 当前页面是不是被宿主 iframe 嵌着。 */
export const isEmbedded = () => window.self !== window.top

/** 请求宿主把主面板切回会话（宿主没装插件时这条消息没人接，等于空操作）。 */
export const leaveHost = () => {
  try {
    window.parent.postMessage({ type: LEAVE_MESSAGE }, '*')
  } catch {
    /* 跨域被拒时什么也不做：这个键只是便利，不该把界面弄崩 */
  }
}