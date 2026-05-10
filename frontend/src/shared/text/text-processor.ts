import { should_skip_by_language_filter } from "../rules/language-filter";
import { is_hangul_character, is_kana_character } from "../rules/languages";
import { should_skip_by_rule_filter } from "../rules/rule-filter";
import { TextTool } from "../utils/text-tool";
import { CodeFixer } from "./fixer/code-fixer";
import { EscapeFixer } from "./fixer/escape-fixer";
import { HangeulFixer } from "./fixer/hangeul-fixer";
import { KanaFixer } from "./fixer/kana-fixer";
import { NumberFixer } from "./fixer/number-fixer";
import { PunctuationFixer } from "./fixer/punctuation-fixer";
import { RubyCleaner } from "./fixer/ruby-cleaner";
import { normalize_text_for_processing } from "./text-normalizer";
import { build_text_preserve_rule, normalize_text_preserve_mode } from "./text-preserve-rules";
import type { TextProcessingConfig, TextQualitySnapshot, TextTaskItemRecord } from "./text-types";

// 姓名前缀兼容半角方括号和全角书名号，保持旧注入格式可逆。
const NAME_PATTERN = /^[\u005b【](.*?)[\u005d】]\s*/iu;
// 空白归一化用于相似度判断，避免换行和多空格影响质量检查。
const BLANK_PATTERN = /\s+/gu;

/**
 * 单个 item 的译前 / 译后文本处理器，完整状态只存在于一个 work unit 内。
 *
 * 处理顺序对齐迁移前 历史 TextProcessor：
 * 正规化 -> 清理注音 -> 文本保护 -> 译前替换 -> 注入姓名 -> 翻译 ->
 * 提取姓名 -> 自动修复 -> 译后替换 -> 恢复文本保护与原始空白。
 */
export class TextProcessor {
  // srcs 是真正送入模型的行，空行和完全保护行不会进入请求。
  public readonly srcs: string[] = [];

  // samples 收集保护段示例，供 PromptBuilder 判断是否补控制字符说明。
  public readonly samples: string[] = [];

  private readonly config: TextProcessingConfig;
  private readonly item: TextTaskItemRecord | null;
  private readonly quality_snapshot: TextQualitySnapshot;
  // valid_index 记录送入模型的源行位置，译后只按这些行回填。
  private readonly valid_index = new Set<number>();
  // 前后缀保护码按行保存，恢复时保持原始控制码位置。
  private readonly prefix_codes = new Map<number, string[]>();
  // suffix_codes 与 prefix_codes 分开保存，避免恢复时改变原始左右顺序。
  private readonly suffix_codes = new Map<number, string[]>();
  // 首尾空白按行保存，避免模型输出规范化后破坏原文件排版。
  private readonly leading_whitespace_by_line = new Map<number, string>();
  // trailing_whitespace_by_line 单独记录尾部空白，保留脚本行末格式。
  private readonly trailing_whitespace_by_line = new Map<number, string>();
  // process_source_text 保存经过 ruby 清理后的源文本，供译后整体回填。
  private process_source_text: string | null = null;

  /**
   * 绑定 config、item 和质量快照；处理器不读取全局 DataManager。
   */
  public constructor(
    config: TextProcessingConfig,
    item: TextTaskItemRecord | null,
    quality_snapshot: TextQualitySnapshot,
  ) {
    this.config = config;
    this.item = item;
    this.quality_snapshot = quality_snapshot;
  }

  /**
   * 姓名前缀注入是翻译和分析共用规则，所以保留为静态入口。
   */
  public static inject_name(srcs: string[], first_name_src: string | null): string[] {
    if (first_name_src !== null && first_name_src !== "" && srcs.length > 0) {
      srcs[0] = `【${first_name_src}】${srcs[0] ?? ""}`;
    }
    return srcs;
  }

  /**
   * 译前处理按固定顺序执行：归一化、ruby、保护、替换、姓名注入。
   */
  public pre_process(): void {
    const item = this.item;
    if (item === null) {
      return;
    }
    const text_type = this.read_text_type(item);
    const source_text = RubyCleaner.clean_item_src(item, this.config.clean_ruby);
    this.process_source_text = source_text;
    for (const [line_index, raw_src] of source_text.split("\n").entries()) {
      let src = this.normalize(raw_src);
      src = this.clean_ruby(src, text_type);
      if (src === "" || src.trim() === "") {
        continue;
      }
      src = this.extract_line_edge_whitespace(line_index, src);
      src = this.prefix_suffix_process(line_index, src, text_type);
      if (src === "") {
        continue;
      }
      if (
        !this.config.auto_process_prefix_suffix_preserved_text &&
        this.is_fully_preserved_line(src, text_type)
      ) {
        continue;
      }
      src = this.replace_pre_translation(src);
      const sample_rule = this.get_re_sample(text_type);
      if (sample_rule !== null) {
        sample_rule.lastIndex = 0;
        this.samples.push(...[...src.matchAll(sample_rule)].map((match) => match[0] ?? ""));
      }
      if (text_type === "MD") {
        this.samples.push("Markdown Code");
      }
      this.srcs.push(src);
      this.valid_index.add(line_index);
    }
    TextProcessor.inject_name(this.srcs, this.read_first_name_src(item));
  }

  /**
   * 译后处理按镜像顺序恢复保护段、执行修复和替换，并回写原始空白。
   */
  public post_process(dsts: string[]): { name: string | null; dst: string } {
    const item = this.item;
    if (item === null) {
      return { name: null, dst: "" };
    }
    const dst_queue = [...dsts];
    const extracted = this.extract_name(this.srcs, dst_queue, item);
    const results: string[] = [];
    const source_text = this.process_source_text ?? String(item.src ?? "");
    for (const [line_index, src] of source_text.split("\n").entries()) {
      let dst: string;
      if (src === "") {
        dst = "";
      } else if (src.trim() === "" || !this.valid_index.has(line_index)) {
        dst = src;
      } else {
        dst = (extracted.dsts.shift() ?? "").trim();
        dst = this.auto_fix(src, dst);
        dst = this.replace_post_translation(dst);
        const prefix_codes = this.prefix_codes.get(line_index) ?? [];
        const suffix_codes = this.suffix_codes.get(line_index) ?? [];
        dst = `${prefix_codes.join("")}${dst}${suffix_codes.join("")}`;
        dst = `${this.leading_whitespace_by_line.get(line_index) ?? ""}${dst}${
          this.trailing_whitespace_by_line.get(line_index) ?? ""
        }`;
      }
      results.push(dst);
    }
    return { name: extracted.name, dst: results.join("\n") };
  }

  /**
   * 文本保护检查比较逐个非空保护段，而不是比较整块命中结果。
   */
  public check(
    src: string,
    dst: string,
    text_type = this.read_text_type(this.item ?? {}),
  ): boolean {
    const rule = this.get_sample_rule(text_type);
    if (rule === null) {
      return true;
    }
    return (
      this.collect_non_blank_preserved_segments(src, rule).join("\u0000") ===
      this.collect_non_blank_preserved_segments(dst, rule).join("\u0000")
    );
  }

  /**
   * 对外暴露样例保护规则，响应校验和代码修复需要使用同一条规则。
   */
  public get_sample_rule(text_type = this.read_text_type(this.item ?? {})): RegExp | null {
    return this.get_re_sample(text_type);
  }

  /**
   * 记录每行原始头尾空白，并返回可参与翻译的正文。
   */
  private extract_line_edge_whitespace(line_index: number, src: string): string {
    const leading_match = src.match(/^\s*/u);
    const trailing_match = src.match(/\s*$/u);
    const leading = leading_match?.[0] ?? "";
    const trailing = trailing_match?.[0] ?? "";
    this.leading_whitespace_by_line.set(line_index, leading);
    this.trailing_whitespace_by_line.set(line_index, trailing);
    return src.slice(leading.length, src.length - trailing.length);
  }

  /**
   * 正规化集中在这里，保持后续规则只面对旧格式兼容后的文本。
   */
  private normalize(src: string): string {
    return normalize_text_for_processing(src);
  }

  /**
   * Ruby 清理受 config.clean_ruby 控制，格式例外由 RubyCleaner 维护。
   */
  private clean_ruby(src: string, text_type: string): string {
    return this.config.clean_ruby ? RubyCleaner.clean(src, text_type) : src;
  }

  /**
   * 自动修复顺序必须保持：语言残留、代码、转义、数字、标点。
   */
  private auto_fix(src: string, dst: string): string {
    let result = dst;
    if (this.config.source_language === "JA") {
      result = KanaFixer.fix(result);
    } else if (this.config.source_language === "KO") {
      result = HangeulFixer.fix(result);
    }
    result = CodeFixer.fix(src, result, this.get_re_sample());
    result = EscapeFixer.fix(src, result);
    result = NumberFixer.fix(src, result);
    result = PunctuationFixer.fix(
      src,
      result,
      this.config.source_language,
      this.config.target_language,
    );
    return result;
  }

  /**
   * 姓名提取只在源 item 确实带 name_src 时启用，避免误吃普通括号文本。
   */
  private extract_name(
    srcs: string[],
    dsts: string[],
    item: TextTaskItemRecord,
  ): { name: string | null; srcs: string[]; dsts: string[] } {
    const first_name_src = this.read_first_name_src(item);
    if (first_name_src === null || srcs.length === 0) {
      return { name: null, srcs, dsts };
    }
    const match = NAME_PATTERN.exec(dsts[0] ?? "");
    const name = match?.[1] ?? null;
    if (name !== null) {
      srcs[0] = (srcs[0] ?? "").replace(NAME_PATTERN, "");
      dsts[0] = (dsts[0] ?? "").replace(NAME_PATTERN, "");
    }
    return { name, srcs, dsts };
  }

  /**
   * 译前替换只消费质量快照，不再读取 历史 DataManager。
   */
  private replace_pre_translation(src: string): string {
    if (!this.quality_snapshot.pre_replacement_enable) {
      return src;
    }
    return this.apply_replacements(src, this.quality_snapshot.pre_replacement_entries);
  }

  /**
   * 译后替换和译前替换共享同一组 regex / literal 语义。
   */
  private replace_post_translation(dst: string): string {
    if (!this.quality_snapshot.post_replacement_enable) {
      return dst;
    }
    return this.apply_replacements(dst, this.quality_snapshot.post_replacement_entries);
  }

  /**
   * 按规则提取前后缀保护段，提取结果在 post_process 末尾恢复。
   */
  private prefix_suffix_process(line_index: number, src: string, text_type: string): string {
    if (!this.config.auto_process_prefix_suffix_preserved_text) {
      return src;
    }
    let result = src;
    const prefix_rule = this.get_re_prefix(text_type);
    if (prefix_rule !== null) {
      const extracted = this.extract(prefix_rule, result);
      result = extracted.line;
      this.prefix_codes.set(line_index, extracted.codes);
    }
    const suffix_rule = this.get_re_suffix(text_type);
    if (suffix_rule !== null) {
      const extracted = this.extract(suffix_rule, result);
      result = extracted.line;
      this.suffix_codes.set(line_index, extracted.codes);
    }
    return result;
  }

  /**
   * 完全保护行不能送给模型，否则会把代码段翻译成自然语言。
   */
  private is_fully_preserved_line(src: string, text_type: string): boolean {
    const rule = this.get_re_check(text_type);
    if (rule === null) {
      return false;
    }
    rule.lastIndex = 0;
    const match = src.match(rule)?.[0] ?? "";
    rule.lastIndex = 0;
    return match === src;
  }

  /**
   * 抽取匹配段并返回剩余正文，供前后缀保护逻辑复用。
   */
  private extract(rule: RegExp, line: string): { line: string; codes: string[] } {
    const codes: string[] = [];
    rule.lastIndex = 0;
    const replaced = line.replace(rule, (match) => {
      codes.push(match);
      return "";
    });
    rule.lastIndex = 0;
    return { line: replaced, codes };
  }

  /**
   * 保护段比较会移除内部空白，和 历史实现的空白规则 口径一致。
   */
  private collect_non_blank_preserved_segments(text: string, rule: RegExp): string[] {
    const segments: string[] = [];
    rule.lastIndex = 0;
    for (const match of text.matchAll(rule)) {
      const segment = (match[0] ?? "").replace(BLANK_PATTERN, "");
      if (segment !== "") {
        segments.push(segment);
      }
    }
    rule.lastIndex = 0;
    return segments;
  }

  /**
   * 替换规则兼容普通替换和正则替换，大小写规则与旧规则保持一致。
   */
  private apply_replacements(
    text: string,
    entries: TextQualitySnapshot["pre_replacement_entries"],
  ): string {
    let result = text;
    for (const entry of entries) {
      const pattern_text = String(entry["src"] ?? "");
      if (pattern_text === "") {
        continue;
      }
      const replacement_text = String(entry["dst"] ?? "");
      const is_regex = entry["regex"] === true;
      const is_case_sensitive = entry["case_sensitive"] === true;
      if (is_regex) {
        result = result.replace(
          new RegExp(pattern_text, is_case_sensitive ? "gu" : "giu"),
          (...args) => this.build_regex_replacement(replacement_text, args),
        );
      } else if (is_case_sensitive) {
        result = result.split(pattern_text).join(replacement_text);
      } else {
        result = result.replace(new RegExp(this.escape_regexp(pattern_text), "giu"), () => {
          return replacement_text;
        });
      }
    }
    return result;
  }

  /**
   * 文本保护规则按运行态 mode 展开，smart 使用共享预置规则，custom 使用用户 entries。
   */
  private build_preserve_rule(
    kind: "check" | "sample" | "prefix" | "suffix",
    text_type = this.read_text_type(this.item ?? {}),
  ): RegExp | null {
    return build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type,
      entries: this.quality_snapshot.text_preserve_entries,
      kind,
    });
  }

  /**
   * 检查规则入口独立命名，便于和 历史 CHECK 规则 对齐。
   */
  private get_re_check(text_type = this.read_text_type(this.item ?? {})): RegExp | null {
    return this.build_preserve_rule("check", text_type);
  }

  /**
   * 样例规则用于控制字符示例、代码修复和响应校验。
   */
  private get_re_sample(text_type = this.read_text_type(this.item ?? {})): RegExp | null {
    return this.build_preserve_rule("sample", text_type);
  }

  /**
   * 前缀保护规则只允许从行首抽取。
   */
  private get_re_prefix(text_type = this.read_text_type(this.item ?? {})): RegExp | null {
    return this.build_preserve_rule("prefix", text_type);
  }

  /**
   * 后缀保护规则只允许从行尾抽取。
   */
  private get_re_suffix(text_type = this.read_text_type(this.item ?? {})): RegExp | null {
    return this.build_preserve_rule("suffix", text_type);
  }

  /**
   * 正则替换兼容 历史正则替换 的常见反向引用，同时避免 JS `$&/$1` 语义误伤字面量。
   */
  private build_regex_replacement(replacement_text: string, args: unknown[]): string {
    const groups = args.at(-1);
    const has_named_groups = typeof groups === "object" && groups !== null;
    const captures = args.slice(1, has_named_groups ? -3 : -2);
    return replacement_text.replace(
      /\\g<([^>]+)>|\\([1-9][0-9]?)|\\([nrt])|\\\\/gu,
      (match, named, index, escaped_char) => {
        if (match === "\\\\") {
          return "\\";
        }
        if (escaped_char === "n") {
          return "\n";
        }
        if (escaped_char === "r") {
          return "\r";
        }
        if (escaped_char === "t") {
          return "\t";
        }
        if (typeof named === "string" && named !== "") {
          const numeric_index = Number.parseInt(named, 10);
          if (Number.isFinite(numeric_index)) {
            return String(captures[numeric_index - 1] ?? "");
          }
          if (has_named_groups && named in (groups as Record<string, unknown>)) {
            return String((groups as Record<string, unknown>)[named] ?? "");
          }
          return "";
        }
        const capture_index = Number.parseInt(String(index), 10);
        return String(captures[capture_index - 1] ?? "");
      },
    );
  }

  /**
   * item 文本类型缺失时按 TXT 处理，避免正则规则读取空键。
   */
  private read_text_type(item: TextTaskItemRecord): string {
    return String(item.text_type ?? "TXT").toUpperCase();
  }

  /**
   * name_src 可以是字符串或数组，worker 只注入第一个非空姓名。
   */
  private read_first_name_src(item: TextTaskItemRecord): string | null {
    const name_src = item.name_src;
    if (typeof name_src === "string" && name_src !== "") {
      return name_src;
    }
    if (Array.isArray(name_src)) {
      const first = name_src.find((name) => typeof name === "string" && name !== "");
      return typeof first === "string" ? first : null;
    }
    return null;
  }

  /**
   * 正则转义集中处理，避免普通替换误解释特殊字符。
   */
  private escape_regexp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
}

/**
 * 响应行质量检查器，按翻译结果决定哪些行可提交。
 */
export class TextResponseChecker {
  /**
   * 退化、解析失败、行数和逐行问题都收口为固定错误字符串。
   */
  public static check(
    srcs: string[],
    dsts: string[],
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    item_retry_count: number,
    stream_degraded: boolean,
  ): string[] {
    if (stream_degraded) {
      return srcs.map(() => "FAIL_DEGRADATION");
    }
    if (dsts.every((value) => value === "")) {
      return srcs.map(() => "FAIL_DATA");
    }
    if (item_retry_count >= 2) {
      return srcs.map(() => "NONE");
    }
    if (srcs.length !== dsts.length) {
      return srcs.map(() => "FAIL_LINE_COUNT");
    }
    return srcs.map((src, index) =>
      this.check_line(src, dsts[index] ?? "", text_type, config, quality_snapshot),
    );
  }

  /**
   * 单行检查顺序保持：空译文、规则过滤、语言过滤、保护段剥离、残留和相似度。
   */
  private static check_line(
    raw_src: string,
    raw_dst: string,
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
  ): string {
    let src = raw_src.trim();
    let dst = raw_dst.trim();
    if (src !== "" && dst === "") {
      return "LINE_ERROR_EMPTY_LINE";
    }
    if (
      should_skip_by_rule_filter(src) ||
      should_skip_by_language_filter(src, config.source_language)
    ) {
      return "NONE";
    }
    const processor = new TextProcessor(config, null, quality_snapshot);
    if (!processor.check(src, dst, text_type)) {
      return "FAIL_DATA";
    }
    const preserve_rule =
      normalize_text_preserve_mode(quality_snapshot.text_preserve_mode) === "off"
        ? null
        : processor.get_sample_rule(text_type);
    if (preserve_rule !== null) {
      src = src.replace(preserve_rule, "");
      dst = dst.replace(preserve_rule, "");
    }
    if (
      config.check_kana_residue &&
      config.source_language === "JA" &&
      [...dst].some((char) => is_kana_character(char))
    ) {
      return "LINE_ERROR_KANA";
    }
    if (
      config.check_hangeul_residue &&
      config.source_language === "KO" &&
      [...dst].some((char) => is_hangul_character(char))
    ) {
      return "LINE_ERROR_HANGEUL";
    }
    if (config.check_similarity && this.is_similar_residue(src, dst, config)) {
      return "LINE_ERROR_SIMILARITY";
    }
    return "NONE";
  }

  /**
   * 相似度在日/韩翻中时只对目标残留字符触发，其他语言按通用相似度判断。
   */
  private static is_similar_residue(
    src: string,
    dst: string,
    config: TextProcessingConfig,
  ): boolean {
    const similar =
      src.includes(dst) ||
      dst.includes(src) ||
      TextTool.check_similarity_by_jaccard(src, dst) > 0.8;
    if (!similar) {
      return false;
    }
    if (config.source_language === "JA" && config.target_language === "ZH") {
      return [...dst].some((char) => is_kana_character(char));
    }
    if (config.source_language === "KO" && config.target_language === "ZH") {
      return [...dst].some((char) => is_hangul_character(char));
    }
    return true;
  }
}
