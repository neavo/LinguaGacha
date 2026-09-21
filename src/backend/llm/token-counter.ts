import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

const TEXT_TOKEN_OPTIONS = {
  disallowedSpecial: new Set<string>(),
};

/** 使用 `o200k_base` 估算正文，特殊标记按普通文本编码。 */
export function count_text_tokens(text: string): number {
  return countTokens(text, TEXT_TOKEN_OPTIONS);
}
