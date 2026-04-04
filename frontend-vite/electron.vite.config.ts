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
