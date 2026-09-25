import type { DesktopBridgeApi } from "@gui/bridge-api";

declare global {
  interface Window {
    desktopApp: DesktopBridgeApi;
  }
}
