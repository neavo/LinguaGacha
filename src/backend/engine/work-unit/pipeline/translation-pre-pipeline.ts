import {
  build_text_preserve_rule,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import {
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../../../../shared/text/text-replacement-rules";
import {
  prepare_translation_source_line,
  type PreparedTranslationSourceLine,
} from "../../../../shared/text/translation-source-line";
import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../../shared/text/text-types";
import { read_optional_item_name_text } from "../../../../shared/item-name";
import type { TranslationRequestItem } from "../translation-item";

/**
 * 翻译译前流程产物，显式保存译后恢复需要的每行状态
 */
export interface TranslationPrePipelineContext {
  item: TextTaskItemRecord | null; // 保留当前 work unit 的可写快照，译后流程只回写这份对象
  prepared_lines: PreparedTranslationSourceLine[]; // Per-line facts used only for deterministic restoration
  request_item: TranslationRequestItem | null; // One complete item record sent to the model, when translatable
  samples: string[]; // 收集保护段示例，供 PromptBuilder 判断是否补控制字符说明
  preserve_rule: TextPreserveRule | null; // 同一 item 的保护能力只编译一次并交给译后流程
}

/**
 * 翻译译前 pipeline，负责把 item 源文本转换成模型输入和显式恢复上下文
 */
export class TranslationPrePipeline {
  private readonly config: TextProcessingConfig; // 语言与文本修复策略的任务启动快照
  private readonly quality_snapshot: TextQualitySnapshot; // 保护与译前替换规则的同轮快照
  private readonly pre_replacements: CompiledTextReplacements | null; // 启用时只编译一次，同一 work unit 复用

  /**
   * 绑定配置快照和质量快照，pipeline 不读取全局会话缓存
   */
  public constructor(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
    this.config = config;
    this.quality_snapshot = quality_snapshot;
    this.pre_replacements = quality_snapshot.pre_replacement_enable
      ? compile_text_replacements(quality_snapshot.pre_replacement_entries)
      : null;
  }

  /**
   * 按固定顺序执行：原样读取 item.src、纯文本 ruby、保护、替换
   */
  public process_item(
    item: TextTaskItemRecord | null,
    item_index = 0,
    request_index = 0,
  ): TranslationPrePipelineContext {
    const context = this.create_empty_context(item);
    if (item === null) {
      return context;
    }
    const text_type = String(item.text_type ?? "TXT").toUpperCase();
    context.preserve_rule = build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type,
      entries: this.quality_snapshot.text_preserve_entries,
    });
    const actor_src = read_optional_item_name_text(item.name_src);
    const source = String(item.src ?? "").replace(/\r\n|\r/gu, "\n");
    for (const [line_index, raw_text] of source.split("\n").entries()) {
      const prepared_line = prepare_translation_source_line({
        line_index,
        raw_text,
        text_type,
        config: this.config,
        preserve_rule: context.preserve_rule,
        pre_replacements: this.pre_replacements,
      });
      context.prepared_lines.push(prepared_line);
      context.samples.push(...prepared_line.samples);
    }
    const has_translatable = context.prepared_lines.some((line) => line.state === "translatable");
    if (has_translatable) {
      context.request_item = {
        request_index,
        item_index,
        text_src: context.prepared_lines.map((line) => line.prepared_text).join("\n"),
        actor_src,
      };
    }
    return context;
  }

  /**
   * 创建空上下文，保证无 item 和空 item 分支也返回同一形状
   */
  private create_empty_context(item: TextTaskItemRecord | null): TranslationPrePipelineContext {
    return {
      item,
      prepared_lines: [],
      request_item: null,
      samples: [],
      preserve_rule: null,
    };
  }
}
