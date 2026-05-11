// 控制码识别规则集中放在这里，避免请求构造和结果清洗各写一套。
const CONTROL_CODE_PATTERN = /\\(?:n|N){1,2}\[\d+\]/gu;

// 伪名列表只服务控制码伪装，尽量降低模型把它们误识别成术语的概率。
const DEFAULT_FAKE_NAMES = [
  "蓝霁云",
  "檀秋萦",
  "墨临川",
  "泠鸢晚",
  "云螭遥",
  "邝溟幽",
  "颛鹤唳",
  "玄璆夜",
  "砚秋辞",
  "聆音澈",
  "雪渟寒",
  "萤照晚",
  "青霭浮",
  "绛霄临",
  "墨漪澜",
  "霜序遥",
  "霁川流",
  "檀烟渺",
  "玄螭隐",
  "青冥远",
  "墨笙寒",
  "霜序晚",
  "霁云舒",
  "檀香凝",
  "玄夜阑",
  "紫陌迁",
  "容止安",
  "蔚迟暮",
  "靖远尘",
  "聆夜笙",
  "绯辞镜",
  "予怀瑾",
  "疏星朗",
  "霁无瑕",
  "素问筠",
  "景行瞻",
  "聆风吟",
  "怀霜澈",
  "静姝窈",
  "思覃远",
  "语凝烟",
  "霁月朗",
  "星河澹",
  "清芷蘅",
  "韶华倾",
  "霁雪霏",
  "云舒卷",
  "風祭宵",
  "月代雫",
  "雨宮静",
  "星影律",
  "霧島朔",
  "時雨遥",
  "雪村茜",
  "花垣葵",
  "水瀬碧",
  "空木凪",
  "音羽奏",
  "琴引紬",
  "篝火茜",
  "砂川凪",
  "藤咲雫",
  "柚木碧",
  "柊木律",
  "楓原宵",
  "霞見遥",
  "篝屋静",
  "草薙朔",
  "月詠茜",
  "風早奏",
  "雪代紬",
  "花散里",
  "鸦羽透",
  "星屑海",
  "铁仙斎",
  "龙胆朔",
  "冬月葵",
  "胧月夜",
  "霞草雫",
  "薄墨葵",
  "绯桜咲",
  "苍海凪",
  "翠岚悠",
  "琥珀川",
  "霁辰砂",
  "暮云合",
  "清漪岚",
  "素影瞳",
  "怀瑾瑜",
  "朗夜汐",
  "轻尘陌",
  "雪霁空",
  "泠然止",
  "澹台清",
  "汐見凪",
  "氷川朔",
  "月白静",
  "風音律",
  "雪華遥",
  "雨夜雫",
];

/**
 * 文本控制码伪名注入器，避免模型把控制码误识别成普通术语。
 */
export class TextFakenameInjector {
  // 原控制码到伪名的映射用于 prompt 前注入，保持同一批次稳定替换。
  private readonly source_to_fake_name = new Map<string, string>();
  // 伪名到控制码的反向映射用于模型响应入池前还原。
  private readonly fake_name_to_source = new Map<string, string>();
  // 伪名正则按长度降序构造，避免短伪名抢先匹配长伪名。
  private readonly fake_name_pattern: RegExp | null;

  /**
   * 构造时收集整批文本控制码，保证同一批次映射稳定。
   */
  public constructor(source_texts: readonly string[]) {
    const control_codes = this.collect_control_codes(source_texts);
    for (const [index, control_code] of control_codes.entries()) {
      const fake_name = this.build_fake_name(index);
      this.source_to_fake_name.set(control_code, fake_name);
      this.fake_name_to_source.set(fake_name, control_code);
    }
    const fake_names = [...this.fake_name_to_source.keys()].sort(
      (left, right) => right.length - left.length,
    );
    this.fake_name_pattern =
      fake_names.length > 0
        ? new RegExp(fake_names.map((name) => this.escape_regexp(name)).join("|"), "gu")
        : null;
  }

  /**
   * 批量替换文本中的控制码，外部上下文仍保留原始值。
   */
  public inject_texts(source_texts: string[]): string[] {
    return source_texts.map((source_text) => this.inject_text(source_text));
  }

  /**
   * 术语候选入池前还原伪名；纯控制码自映射单独放行。
   */
  public restore_glossary_entry(src: string, dst: string): [string, string] | null {
    const [restored_src, injected] = this.restore_text(src);
    if (!injected) {
      return [src, dst];
    }
    if (!TextFakenameInjector.is_control_code_text(restored_src)) {
      return null;
    }
    return [restored_src, restored_src];
  }

  /**
   * 纯控制码自映射术语允许进入候选池。
   */
  public static is_control_code_self_mapping(src: string, dst: string): boolean {
    const normalized_src = src.trim();
    const normalized_dst = dst.trim();
    return (
      normalized_src !== "" &&
      normalized_src === normalized_dst &&
      TextFakenameInjector.is_control_code_text(normalized_src)
    );
  }

  /**
   * 判断文本是否只包含一个控制码。
   */
  public static is_control_code_text(text: string): boolean {
    const normalized_text = text.trim();
    if (normalized_text === "") {
      return false;
    }
    CONTROL_CODE_PATTERN.lastIndex = 0;
    const matched = normalized_text.match(CONTROL_CODE_PATTERN);
    CONTROL_CODE_PATTERN.lastIndex = 0;
    return matched?.length === 1 && matched[0] === normalized_text;
  }

  /**
   * 单条文本注入伪名，未命中时原样返回。
   */
  private inject_text(source_text: string): string {
    CONTROL_CODE_PATTERN.lastIndex = 0;
    const result = source_text.replace(
      CONTROL_CODE_PATTERN,
      (match) => this.source_to_fake_name.get(match) ?? match,
    );
    CONTROL_CODE_PATTERN.lastIndex = 0;
    return result;
  }

  /**
   * 按首次出现顺序去重收集控制码。
   */
  private collect_control_codes(source_texts: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const source_text of source_texts) {
      CONTROL_CODE_PATTERN.lastIndex = 0;
      for (const match of source_text.matchAll(CONTROL_CODE_PATTERN)) {
        const control_code = match[0] ?? "";
        if (seen.has(control_code)) {
          continue;
        }
        seen.add(control_code);
        result.push(control_code);
      }
    }
    CONTROL_CODE_PATTERN.lastIndex = 0;
    return result;
  }

  /**
   * 默认伪名不够时用固定编号扩展，避免回退到原控制码。
   */
  private build_fake_name(index: number): string {
    return DEFAULT_FAKE_NAMES[index] ?? `伪名${String(index + 1).padStart(4, "0")}`;
  }

  /**
   * 还原候选术语里的伪名，并返回是否发生替换。
   */
  private restore_text(text: string): [string, boolean] {
    if (this.fake_name_pattern === null || text === "") {
      return [text, false];
    }
    const restored = text.replace(
      this.fake_name_pattern,
      (match) => this.fake_name_to_source.get(match) ?? match,
    );
    return [restored, restored !== text];
  }

  /**
   * 正则转义集中处理，保证伪名列表可安全拼接。
   */
  private escape_regexp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
}
