import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // 将主进程入口固定在 src/main，保持 Electron 侧目录边界清晰。
        entry: 'src/main/index.ts',
      },
      preload: {
        // 预加载脚本和主进程放在同一侧，方便后续统一维护安全桥接。
        input: path.join(__dirname, 'src/main/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
