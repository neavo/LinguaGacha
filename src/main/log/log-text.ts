import fs from "node:fs";

import type { AppPathService } from "../service/path-service";
import { DEFAULT_SETTING } from "../../base/setting";
import { create_text_resolver, resolve_i18n_locale, type LocaleKey } from "../../shared/i18n";
import { JsonTool } from "../../shared/utils/json-tool";

let active_paths: AppPathService | null = null;

export function set_main_log_text_paths(paths: AppPathService | null): void {
  active_paths = paths;
}

export function t_main_log(key: LocaleKey, params: Record<string, string> = {}): string {
  const locale = resolve_i18n_locale(read_app_language());
  return create_text_resolver(locale)(key, params);
}

function read_app_language(): unknown {
  if (active_paths === null) {
    return DEFAULT_SETTING["app_language"];
  }

  const config_path = active_paths.get_config_path();
  if (!fs.existsSync(config_path)) {
    return DEFAULT_SETTING["app_language"];
  }

  try {
    const payload = JsonTool.parseStrict(fs.readFileSync(config_path));
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return (payload as Record<string, unknown>)["app_language"];
    }
  } catch {
    // 日志本地化读取配置失败时回退默认语言，不能反过来阻断原始日志写出
  }
  return DEFAULT_SETTING["app_language"];
}
