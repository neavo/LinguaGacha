import type { LanguageCode } from "@domain/setting";
import type { LocaleKey } from "@frontend/app/locale/locale-provider";

export type LanguageLabelKey = Extract<LocaleKey, `app.language.${LanguageCode}`>;

/** renderer 在自己的 i18n 边界投影语言标签，领域层拥有合法语言码。 */
export function get_language_label_key(language_code: LanguageCode): LanguageLabelKey {
  return `app.language.${language_code}`;
}
