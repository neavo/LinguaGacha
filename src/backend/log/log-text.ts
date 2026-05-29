import { DEFAULT_SETTING } from "../../domain/setting";
import { create_text_resolver, resolve_i18n_locale, type LocaleKey } from "../../shared/i18n";

type AppLanguageReader = () => unknown;

let active_language_reader: AppLanguageReader | null = null; // active_language_reader 由 AppSettingService 注入，启动早期为空时使用默认语言

/**
 * 注入日志文案语言读取器，避免日志层直接读取 config.json。
 */
export function set_main_log_language_reader(reader: AppLanguageReader | null): void {
  active_language_reader = reader;
}

/**
 * 按当前应用语言解析 Electron 主进程日志文案。
 */
export function t_main_log(key: LocaleKey, params: Record<string, string> = {}): string {
  const locale = resolve_i18n_locale(read_app_language());
  return create_text_resolver(locale)(key, params);
}

/**
 * 读取当前日志语言；读取器异常时回退默认语言，避免日志写出被配置错误阻断。
 */
function read_app_language(): unknown {
  try {
    return active_language_reader?.() ?? DEFAULT_SETTING["app_language"];
  } catch {
    return DEFAULT_SETTING["app_language"];
  }
}
