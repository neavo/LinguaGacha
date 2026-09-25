export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      VITE_PUBLIC?: string; // 开发启动时注入，生产环境可按产物位置回退
    }
  }
}
