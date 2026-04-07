import { defineConfig } from 'electron-vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const config = {
  main: {
    build: {
      outDir: 'dist-electron',
    },
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/main/index.ts'),
      },
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
    },
    rollupOptions: {
      input: {
        preload: path.resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    publicDir: path.resolve(__dirname, 'public'),
    server: {
      // 开发态 renderer 统一监听 IPv4 回环地址，避免主进程与 dev server 对本机地址的解析结果不一致。
      // 这里定义的是唯一权威监听地址，不再依赖 localhost 或额外兼容回退。
      host: '127.0.0.1',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: '../../dist',
    },
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
}

// electron-vite 5 的运行时支持 `build.outDir`，但当前类型声明尚未完整覆盖这层配置。
export default defineConfig(config as import('electron-vite').UserConfig)
