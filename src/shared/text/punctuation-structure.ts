// 分组只表达结构等价；括号保留开闭方向，引号允许不同语言的排版形式。
const PUNCTUATION_GROUPS = {
  QUOTE: '“”„‟「」『』«»"＂', // ponytail: 同组错配会通过，更细的方向检查需另行确定语言语义。
  ROUND_OPEN: "(（",
  ROUND_CLOSE: ")）",
  SQUARE_OPEN: "[［【",
  SQUARE_CLOSE: "]］】",
  BRACE_OPEN: "{｛",
  BRACE_CLOSE: "}｝",
  TITLE_OPEN: "《",
  TITLE_CLOSE: "》",
} as const;

// 预编译字符查找表，正文扫描时无需逐组寻找归属。
const PUNCTUATION_GROUP_BY_CHARACTER: ReadonlyMap<string, string> = new Map(
  Object.entries(PUNCTUATION_GROUPS).flatMap(([group, characters]) =>
    Array.from(characters, (character) => [character, group] as const),
  ),
);

/** 按出现顺序提取结构标记，正文和换行不进入序列。 */
function collect_punctuation_structure(text: string): string[] {
  const structure: string[] = [];
  for (const character of text) {
    const group = PUNCTUATION_GROUP_BY_CHARACTER.get(character);
    if (group !== undefined) structure.push(group);
  }
  return structure;
}

/** 比较已剥离保护段和资源引用的正文，整对增删及补齐原文半边结构也属于差异。 */
export function has_punctuation_structure_mismatch(args: { src: string; dst: string }): boolean {
  const source = collect_punctuation_structure(args.src);
  const translation = collect_punctuation_structure(args.dst);
  return (
    source.length !== translation.length ||
    source.some((group, index) => group !== translation[index])
  );
}
