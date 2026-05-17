/// <reference types="electron-vite/node" />

import type { DesktopBridgeApi } from "./native/bridge-api";

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string;
    VITE_PUBLIC: string;
  }
}

declare global {
  interface Window {
    desktopApp: DesktopBridgeApi;
  }
}

export {};
