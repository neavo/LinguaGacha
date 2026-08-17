/// <reference types="electron-vite/node" />
/// <reference types="vite/client" />

import type { DesktopBridgeApi } from "./gui/bridge/bridge-api";

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
