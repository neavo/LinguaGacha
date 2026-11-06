import { app } from "electron";

import { resolve_app_locale, resolve_system_app_language } from "../domain/app-language";

/** 在 Electron ready 前固定发行包支持的语言，避免覆盖安装残留资源参与选择。 */
export function configure_app_locale(): void {
  const locale = resolve_app_locale(resolve_system_app_language(app.getPreferredSystemLanguages()));
  app.commandLine.appendSwitch("lang", locale);
}
