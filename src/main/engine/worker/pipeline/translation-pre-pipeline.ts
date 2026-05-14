import { TextRubyCleaner } from "../../../../shared/text/text-ruby-cleaner";
import { normalize_text_for_processing } from "../../../../shared/text/text-normalizer";
import { inject_text_name_prefix } from "../../../../shared/text/text-name-prefix";
import { build_text_preserve_rule } from "../../../../shared/text/text-preserve-rules";
import { apply_text_replacements } from "../../../../shared/text/text-replacement-rules";
import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../../shared/text/text-types";

/**
 * 翻译译前流程产物，显式保存译后恢复需要的每行状态
 */
export interface TranslationPrePipelineContext {
  item: TextTaskItemRecord | null; // item 保留当前 work unit 的可写快照，译后流程只回写这份对象
  source_text: string; // source_text 是 ruby 清理后的完整源文本，译后按原行数重建 dst
  srcs: string[]; // srcs 是真正送入模型的行，空行和完全保护行不会进入请求
  samples: string[]; // samples 收集保护段示例，供 PromptBuilder 判断是否补控制字符说明
  valid_line_indexes: Set<number>; // valid_line_indexes 记录送入模型的源行位置，译后只按这些行回填
  prefix_codes_by_line: Map<number, string[]>; // prefix_codes_by_line 按行保存前缀保护码，恢复时保持原始左侧位置
  suffix_codes_by_line: Map<number, string[]>; // suffix_codes_by_line 单独保存后缀保护码，避免恢复时改变原始右侧顺序
  leading_whitespace_by_line: Map<number, string>; // leading_whitespace_by_line 记录行首空白，避免模型输出破坏原文件排版
  trailing_whitespace_by_line: Map<number, string>; // trailing_whitespace_by_line 记录行尾空白，保留脚本行末格式
}

/**
 * 翻译译前 pipeline，负责把 item 源文本转换成模型输入和显式恢复上下文
 */
export class TranslationPrePipeline {
  private readonly config: TextProcessingConfig;
  private readonly quality_snapshot: TextQualitySnapshot;

  /**
   * 绑定配置快照和质量快照，pipeline 不读取全局会话缓存
   */
  public constructor(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
    this.config = config;
    this.quality_snapshot = quality_snapshot;
  }

  /**
   * 按固定顺序执行：归一化、ruby、保护、替换、姓名注入
   */
  public process_item(item: TextTaskItemRecord | null): TranslationPrePipelineContext {
    const context = this.create_empty_context(item);
    if (item === null) {
      return context;
    }
    const text_type = this.read_text_type(item);
    context.source_text = TextRubyCleaner.clean_item_src(item, this.config.clean_ruby);
    for (const [line_index, raw_src] of context.source_text.split("\n").entries()) {
      let src = normalize_text_for_processing(raw_src);
      src = this.clean_ruby(src, text_type);
      if (src === "" || src.trim() === "") {
        continue;
      }
      src = this.extract_line_edge_whitespace(context, line_index, src);
      src = this.prefix_suffix_process(context, line_index, src, text_type);
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
      this.collect_samples(context, src, text_type);
      context.srcs.push(src);
      context.valid_line_indexes.add(line_index);
    }
    context.srcs = inject_text_name_prefix(context.srcs, this.read_first_name_src(item));
    return context;
  }

  /**
   * 创建空上下文，保证无 item 和空 item 分支也返回同一形状
   */
  private create_empty_context(item: TextTaskItemRecord | null): TranslationPrePipelineContext {
    return {
      item,
      source_text: "",
      srcs: [],
      samples: [],
      valid_line_indexes: new Set<number>(),
      prefix_codes_by_line: new Map<number, string[]>(),
      suffix_codes_by_line: new Map<number, string[]>(),
      leading_whitespace_by_line: new Map<number, string>(),
      trailing_whitespace_by_line: new Map<number, string>(),
    };
  }

  /**
   * Ruby 行级清理受 clean_ruby 控制，格式例外由 TextRubyCleaner 维护
   */
  private clean_ruby(src: string, text_type: string): string {
    return this.config.clean_ruby ? TextRubyCleaner.clean(src, text_type) : src;
  }

  /**
   * 记录每行原始头尾空白，并返回可参与翻译的正文
   */
  private extract_line_edge_whitespace(
    context: TranslationPrePipelineContext,
    line_index: number,
    src: string,
  ): string {
    const leading_match = src.match(/^\s*/u);
    const trailing_match = src.match(/\s*$/u);
    const leading = leading_match?.[0] ?? "";
    const trailing = trailing_match?.[0] ?? "";
    context.leading_whitespace_by_line.set(line_index, leading);
    context.trailing_whitespace_by_line.set(line_index, trailing);
    return src.slice(leading.length, src.length - trailing.length);
  }

  /**
   * 按规则提取前后缀保护段，提取结果在译后流程末尾恢复
   */
  private prefix_suffix_process(
    context: TranslationPrePipelineContext,
    line_index: number,
    src: string,
    text_type: string,
  ): string {
    if (!this.config.auto_process_prefix_suffix_preserved_text) {
      return src;
    }
    let result = src;
    const prefix_rule = this.get_re_prefix(text_type);
    if (prefix_rule !== null) {
      const extracted = this.extract(prefix_rule, result);
      result = extracted.line;
      context.prefix_codes_by_line.set(line_index, extracted.codes);
    }
    const suffix_rule = this.get_re_suffix(text_type);
    if (suffix_rule !== null) {
      const extracted = this.extract(suffix_rule, result);
      result = extracted.line;
      context.suffix_codes_by_line.set(line_index, extracted.codes);
    }
    return result;
  }

  /**
   * 完全保护行不能送给模型，否则会把代码段翻译成自然语言
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
   * 译前替换只消费质量快照
   */
  private replace_pre_translation(src: string): string {
    if (!this.quality_snapshot.pre_replacement_enable) {
      return src;
    }
    return apply_text_replacements(src, this.quality_snapshot.pre_replacement_entries);
  }

  /**
   * 收集控制字符示例，Markdown 额外注入固定代码示例
   */
  private collect_samples(
    context: TranslationPrePipelineContext,
    src: string,
    text_type: string,
  ): void {
    const sample_rule = this.get_re_sample(text_type);
    if (sample_rule !== null) {
      sample_rule.lastIndex = 0;
      context.samples.push(...[...src.matchAll(sample_rule)].map((match) => match[0] ?? ""));
    }
    if (text_type === "MD") {
      context.samples.push("Markdown Code");
    }
  }

  /**
   * 抽取匹配段并返回剩余正文，供前后缀保护逻辑复用
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
   * 文本保护规则按运行态 mode 展开，smart 使用共享预置规则，custom 使用用户 entries
   */
  private build_preserve_rule(
    kind: "check" | "sample" | "prefix" | "suffix",
    text_type: string,
  ): RegExp | null {
    return build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type,
      entries: this.quality_snapshot.text_preserve_entries,
      kind,
    });
  }

  /**
   * 检查规则入口独立命名，便于和 CHECK 规则对齐
   */
  private get_re_check(text_type: string): RegExp | null {
    return this.build_preserve_rule("check", text_type);
  }

  /**
   * 样例规则用于控制字符示例和响应校验
   */
  private get_re_sample(text_type: string): RegExp | null {
    return this.build_preserve_rule("sample", text_type);
  }

  /**
   * 前缀保护规则只允许从行首抽取
   */
  private get_re_prefix(text_type: string): RegExp | null {
    return this.build_preserve_rule("prefix", text_type);
  }

  /**
   * 后缀保护规则只允许从行尾抽取
   */
  private get_re_suffix(text_type: string): RegExp | null {
    return this.build_preserve_rule("suffix", text_type);
  }

  /**
   * item 文本类型缺失时按 TXT 处理，避免正则规则读取空键
   */
  private read_text_type(item: TextTaskItemRecord): string {
    return String(item.text_type ?? "TXT").toUpperCase();
  }

  /**
   * name_src 可以是字符串或数组，worker 只注入第一个非空姓名
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
}
