import { useEffect } from 'react'

export function MainProcessBridge(): null {
  useEffect(() => {
    // 把桥接监听放回 React 生命周期里，避免开发期热更新重复挂载监听器。
    const unsubscribe = window.desktopApp.onMainProcessMessage((message) => {
      console.log(message)
    })

    return unsubscribe
  }, [])

  return null
}
