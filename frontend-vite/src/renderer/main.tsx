import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 使用预加载脚本暴露的桥接能力，确保后续 Electron 事件接入路径稳定。
window.desktopApp.onMainProcessMessage((message) => {
  console.log(message)
})
