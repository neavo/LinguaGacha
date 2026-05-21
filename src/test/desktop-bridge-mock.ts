import type { DesktopBridgeApi } from "../gui/bridge/bridge-api";
import type { DesktopCoreApiInfo, DesktopShellInfo } from "../gui/bridge/bridge-types";
import { EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE } from "../gui/bridge/system-proxy-startup-notice";
import { resolve_desktop_shell_info } from "../gui/shell/shell-contract";

export const DESKTOP_BRIDGE_TEST_BASE_URL = "http://127.0.0.1:38191";

export type DesktopBridgeApiMockOverrides = {
  shell?: Partial<DesktopShellInfo>;
  coreApi?: Partial<DesktopCoreApiInfo>;
  methods?: Partial<Omit<DesktopBridgeApi, "shell" | "coreApi">>;
};

// renderer 测试统一从这里生成 window.desktopApp，避免桥接契约在多个测试里手写漂移
export function create_desktop_bridge_api_mock(
  overrides: DesktopBridgeApiMockOverrides = {},
): DesktopBridgeApi {
  const shell: DesktopShellInfo = {
    ...resolve_desktop_shell_info("win32"),
    ...overrides.shell,
  };
  const coreApi: DesktopCoreApiInfo = {
    baseUrl: DESKTOP_BRIDGE_TEST_BASE_URL,
    systemProxyStartupNotice: EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE,
    ...overrides.coreApi,
  };

  return {
    shell,
    coreApi,
    getPathForFile: () => "",
    setTitleBarTheme: () => {},
    quitApp: async () => {},
    openLogWindow: async () => {},
    onWindowCloseRequest: () => {
      return () => {};
    },
    openExternalUrl: async () => {},
    pickProjectSourceFilePath: async () => ({ canceled: true, paths: [] }),
    pickProjectSourceDirectoryPath: async () => ({ canceled: true, paths: [] }),
    pickProjectFilePath: async () => ({ canceled: true, paths: [] }),
    pickProjectSavePath: async () => ({ canceled: true, paths: [] }),
    pickWorkbenchFilePath: async () => ({ canceled: true, paths: [] }),
    pickFixedProjectDirectory: async () => ({ canceled: true, paths: [] }),
    pickGlossaryImportFilePath: async () => ({ canceled: true, paths: [] }),
    pickGlossaryExportPath: async () => ({ canceled: true, paths: [] }),
    pickPromptImportFilePath: async () => ({ canceled: true, paths: [] }),
    pickPromptExportFilePath: async () => ({ canceled: true, paths: [] }),
    ...overrides.methods,
  };
}
