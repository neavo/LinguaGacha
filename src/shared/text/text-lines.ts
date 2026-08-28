/** Normalize all supported line endings to LF. */
export function normalize_text_line_breaks(text: string): string {
  return text.replace(/\r\n|\r/gu, "\n");
}

/** Split normalized text while preserving empty and trailing lines. */
export function split_text_lines(text: string): string[] {
  return normalize_text_line_breaks(text).split("\n");
}
