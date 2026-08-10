import type { LanguageCode } from "@domain/setting";
import type { LocaleKey } from "@frontend/app/locale/locale-provider";

export type LanguageLabelKey = Extract<LocaleKey, `app.language.${LanguageCode}`>;

/** renderer 在自己的 i18n 边界投影语言标签，领域层只拥有语言码与显示名称。 */
export function get_language_label_key(language_code: LanguageCode): LanguageLabelKey {
  return `app.language.${language_code}`;
}
