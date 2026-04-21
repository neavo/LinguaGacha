const NONE_PATTERNS = [
  '<br>',
  '\\s',
] as const

const RENPY_LIKE_PATTERNS = [
  '\\{[^\\{\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]*?\\}',
  '\\[[^\\[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]*?\\]',
  ...NONE_PATTERNS,
] as const

const RPGMAKER_LIKE_PATTERNS = [
  '<.+?:.+?>',
  'en\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)',
  'if\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)',
  '[<【]{0,1}[/\\\\][a-z]{1,8}[<\\[][a-z\\d]{0,16}[>\\]][>】]{0,1}',
  '%\\d+',
  '@\\d+',
  '\\\\[cus]db\\[.+?:.+?:.+?\\]',
  '\\\\f[rbi]',
  '\\\\[\\{\\}]',
  '\\\\\\$',
  '\\\\\\.',
  '\\\\\\|',
  '\\\\!',
  '\\\\>',
  '\\\\<',
  '\\\\\\^',
  '[/\\\\][a-z]{1,8}(?=<.{0,16}>|\\[.{0,16}\\])',
  '\\\\[a-z](?=[^a-z<>\\[\\]])',
  ...NONE_PATTERNS,
] as const

export const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: NONE_PATTERNS,
  MD: NONE_PATTERNS,
  KAG: RENPY_LIKE_PATTERNS,
  RENPY: RENPY_LIKE_PATTERNS,
  RPGMAKER: RPGMAKER_LIKE_PATTERNS,
  WOLF: RPGMAKER_LIKE_PATTERNS,
} as const
