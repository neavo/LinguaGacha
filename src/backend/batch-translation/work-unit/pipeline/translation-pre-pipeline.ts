import {
  build_text_preserve_rule,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import {
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../../../../shared/text/text-replacement-rules";
import {
  prepare_translation_source,
  type PreparedTranslationSourceLine,
} from "../../../../shared/text/translation-source";
import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../../shared/text/text-types";
import { read_optional_item_name_text } from "../../../../shared/item-name";
import {
  project_text_resource_references,
  type TextResourceReferenceMapping,
} from "../../../../shared/text/text-resource-reference";
import type { TranslationRequestItem } from "../translation-item";

/**
 * 翻译译前流程产物，显式保存译后恢复需要的每行状态
 */
export interface TranslationPrePipelineContext {
  prepared_lines: PreparedTranslationSourceLine[]; // 请求与译后恢复共用逐行准备结果。
  request_item: TranslationRequestItem | null; // 全部行均保留时跳过请求。
  samples: string[]; // 收集保护段示例，供 PromptBuilder 判断是否补控制字符说明
  preserve_rule: TextPreserveRule; // 同一条目的保护规则由译前和译后共用。
  reference_mappings: TextResourceReferenceMapping[]; // 当前请求正文的临时引用恢复映射
  actor_reference_mappings: TextResourceReferenceMapping[]; // 当前请求姓名的临时引用恢复映射
}

/**
 * 翻译译前 pipeline，负责把 item 源文本转换成模型输入和显式恢复上下文
 */
export class TranslationPrePipeline {
  private readonly config: TextProcessingConfig; // 语言与文本修复策略的任务启动快照
  private readonly quality_snapshot: TextQualitySnapshot; // 保护与译前替换规则的同轮快照
  private readonly pre_replacements: CompiledTextReplacements | null; // 启用时只编译一次，同一 work unit 复用
  private next_reference_ordinal = 0; // 单个 work unit 内按模型输入顺序生成扁平 token

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
   * 按固定顺序执行：引用投影、纯文本 ruby、保护、替换
   */
  public process_item(
    item: TextTaskItemRecord,
    item_index = 0,
    request_id = 0,
  ): TranslationPrePipelineContext {
    const text_type = String(item.text_type ?? "TXT").toUpperCase();
    const preserve_rule = build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type,
      entries: this.quality_snapshot.text_preserve_entries,
    });
    const prepared = prepare_translation_source({
      src: String(item.src ?? ""),
      name_src: read_optional_item_name_text(item.name_src),
      text_type,
      config: this.config,
      preserve_rule,
      pre_replacements: this.pre_replacements,
      start_ordinal: this.next_reference_ordinal,
    });
    this.next_reference_ordinal = prepared.body.next_ordinal;
    const context: TranslationPrePipelineContext = {
      prepared_lines: prepared.prepared_lines,
      request_item: null,
      samples: prepared.samples,
      preserve_rule,
      reference_mappings: prepared.body.mappings,
      actor_reference_mappings: prepared.name?.mappings ?? [],
    };
    const has_translatable = context.prepared_lines.some((line) => line.state === "translatable");
    if (has_translatable) {
      context.request_item = {
        request_id,
        item_index,
        text_src: context.prepared_lines.map((line) => line.prepared_text).join("\n"),
        actor_src: prepared.name?.text ?? null,
      };
    }
    return context;
  }

  /** 投影只读上文并延续当前 work unit 序号，不保存无需恢复的映射。 */
  public project_precedings(items: TextTaskItemRecord[]): TextTaskItemRecord[] {
    return items.map((item) => ({
      ...item,
      src: this.project_text(String(item.src ?? "")).text,
    }));
  }

  /** 为 work unit 中的所有模型输入分配唯一递增的资源引用序号。 */
  private project_text(text: string): ReturnType<typeof project_text_resource_references> {
    const projection = project_text_resource_references(text, this.next_reference_ordinal);
    this.next_reference_ordinal = projection.next_ordinal;
    return projection;
  }
}
