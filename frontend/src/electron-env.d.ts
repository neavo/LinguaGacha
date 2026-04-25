/// <reference types="electron-vite/node" />

import type { DesktopPathPickResult, DesktopShellInfo, ThemeMode } from "./shared/desktop-types";

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string;
    VITE_PUBLIC: string;
  }
}

declare global {
  interface Window {
    desktopApp: {
      shell: DesktopShellInfo;
      coreApi: {
        baseUrl: string;
      };
      getPathForFile: (file: File) => string;
      setTitleBarTheme: (theme_mode: ThemeMode) => void;
      quitApp: () => Promise<void>;
      onWindowCloseRequest: (callback: () => void) => () => void;
      openExternalUrl: (url: string) => Promise<void>;
      pickProjectSourceFilePath: () => Promise<DesktopPathPickResult>;
      pickProjectSourceDirectoryPath: () => Promise<DesktopPathPickResult>;
      pickProjectFilePath: () => Promise<DesktopPathPickResult>;
      pickProjectSavePath: (default_name: string) => Promise<DesktopPathPickResult>;
      pickWorkbenchFilePath: () => Promise<DesktopPathPickResult>;
      pickFixedProjectDirectory: (default_path?: string) => Promise<DesktopPathPickResult>;
      pickGlossaryImportFilePath: () => Promise<DesktopPathPickResult>;
      pickGlossaryExportPath: (default_name: string) => Promise<DesktopPathPickResult>;
      pickPromptImportFilePath: () => Promise<DesktopPathPickResult>;
      pickPromptExportFilePath: () => Promise<DesktopPathPickResult>;
    };
  }
}

export {};
