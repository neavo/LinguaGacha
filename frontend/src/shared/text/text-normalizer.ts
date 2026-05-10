// 正规化规则对齐旧 历史 Normalizer：先 NFC，再执行项目自定义兼容映射。
const CUSTOM_NORMALIZE_RULES = new Map<string, string>();

for (let code_point = 0xff21; code_point <= 0xff3a; code_point += 1) {
  CUSTOM_NORMALIZE_RULES.set(
    String.fromCodePoint(code_point),
    String.fromCodePoint(code_point - 0xfee0),
  );
}

for (let code_point = 0xff41; code_point <= 0xff5a; code_point += 1) {
  CUSTOM_NORMALIZE_RULES.set(
    String.fromCodePoint(code_point),
    String.fromCodePoint(code_point - 0xfee0),
  );
}

for (let code_point = 0xff10; code_point <= 0xff19; code_point += 1) {
  CUSTOM_NORMALIZE_RULES.set(
    String.fromCodePoint(code_point),
    String.fromCodePoint(code_point - 0xfee0),
  );
}

const HALFWIDTH_KATAKANA_RULES: Record<string, string> = {
  ｱ: "ア",
  ｲ: "イ",
  ｳ: "ウ",
  ｴ: "エ",
  ｵ: "オ",
  ｶ: "カ",
  ｷ: "キ",
  ｸ: "ク",
  ｹ: "ケ",
  ｺ: "コ",
  ｻ: "サ",
  ｼ: "シ",
  ｽ: "ス",
  ｾ: "セ",
  ｿ: "ソ",
  ﾀ: "タ",
  ﾁ: "チ",
  ﾂ: "ツ",
  ﾃ: "テ",
  ﾄ: "ト",
  ﾅ: "ナ",
  ﾆ: "ニ",
  ﾇ: "ヌ",
  ﾈ: "ネ",
  ﾉ: "ノ",
  ﾊ: "ハ",
  ﾋ: "ヒ",
  ﾌ: "フ",
  ﾍ: "ヘ",
  ﾎ: "ホ",
  ﾏ: "マ",
  ﾐ: "ミ",
  ﾑ: "ム",
  ﾒ: "メ",
  ﾓ: "モ",
  ﾔ: "ヤ",
  ﾕ: "ユ",
  ﾖ: "ヨ",
  ﾗ: "ラ",
  ﾘ: "リ",
  ﾙ: "ル",
  ﾚ: "レ",
  ﾛ: "ロ",
  ﾜ: "ワ",
  ｦ: "ヲ",
  ﾝ: "ン",
  ｧ: "ァ",
  ｨ: "ィ",
  ｩ: "ゥ",
  ｪ: "ェ",
  ｫ: "ォ",
  ｬ: "ャ",
  ｭ: "ュ",
  ｮ: "ョ",
  ｯ: "ッ",
  ｰ: "ー",
  ﾞ: "゛",
  ﾟ: "゜",
};

for (const [source, target] of Object.entries(HALFWIDTH_KATAKANA_RULES)) {
  CUSTOM_NORMALIZE_RULES.set(source, target);
}

/**
 * 文本处理正规化入口，保持迁移前 历史 Normalizer 的可观察语义。
 */
export function normalize_text_for_processing(text: string): string {
  return [...text.normalize("NFC")]
    .map((char) => CUSTOM_NORMALIZE_RULES.get(char) ?? char)
    .join("");
}
