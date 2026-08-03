import { QualityRuleSnapshotTool } from "../quality/quality-rule-snapshot";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";
import type { TextPreserveEntry, TextReplacementEntry } from "../../domain/quality";

/**
 * 文本处理只依赖的配置字段，字段名保持配置快照兼容
 */
export interface TextProcessingConfig {
  source_language: string; // 源/目标语言直接来自项目配置，语言过滤器负责未知值兜底
  target_language: string;
  clean_ruby: boolean; // 只控制字面文本注音标记，结构化格式组装留在导入器
  auto_process_prefix_suffix_preserved_text: boolean; // 自动保护前后缀开关决定完全保护行是否仍进入翻译流程
}

/**
 * 质量规则快照归一后只保留 worker 必须知道的稳定事实
 */
export interface TextQualitySnapshot {
  glossary_enable: boolean; // glossary 与 replacement 规则均为运行时快照，worker 不回读数据库
  glossary_entries: JsonRecord[];
  text_preserve_mode: string;
  text_preserve_entries: TextPreserveEntry[];
  pre_replacement_enable: boolean;
  pre_replacement_entries: TextReplacementEntry[];
  post_replacement_enable: boolean;
  post_replacement_entries: TextReplacementEntry[];
  translation_prompt_enable: boolean; // prompt 字段来自提示词设置页，PromptBuilder 负责与资源模板合并
  translation_prompt: string;
  analysis_prompt_enable: boolean;
  analysis_prompt: string;
}

/**
 * 任务 item 的最小形状，runner 只按这些字段读写翻译事实
 */
export type TextTaskItemRecord = JsonRecord & {
  id?: number; // id/item_id 同时兼容数据库行和前端运行态条目
  item_id?: number;
  src?: string; // src/dst/status 是翻译提交的核心事实，其余字段只辅助处理
  dst?: string;
  name_src?: string | string[] | null;
  name_dst?: string | string[] | null;
  status?: string;
  text_type?: string; // 决定保护规则分支，retry_count 用于任务调度诊断
  retry_count?: number;
  skip_internal_filter?: boolean; // 强制翻译条目绕过规则/语言类内部过滤
  extra_field?: JsonValue; // 保留格式处理器回写所需的结构化上下文
};

/**
 * 质量快照解析工具，集中兼容嵌套 payload 和旧扁平字段
 */
export class TextQualitySnapshotTool {
  /**
   * 从 API JSON 恢复成不可变值对象；缺失字段按质量规则领域默认值处理
   */
  public static from_api_value(value: JsonValue | undefined): TextQualitySnapshot {
    const snapshot = QualityRuleSnapshotTool.from_json(value);
    return {
      glossary_enable: snapshot.glossary_enable,
      glossary_entries: snapshot.glossary_entries,
      text_preserve_mode: snapshot.text_preserve_mode,
      text_preserve_entries: snapshot.text_preserve_entries,
      pre_replacement_enable: snapshot.pre_replacement_enable,
      pre_replacement_entries: snapshot.pre_replacement_entries,
      post_replacement_enable: snapshot.post_replacement_enable,
      post_replacement_entries: snapshot.post_replacement_entries,
      translation_prompt_enable: snapshot.translation_prompt_enable,
      translation_prompt: snapshot.translation_prompt,
      analysis_prompt_enable: snapshot.analysis_prompt_enable,
      analysis_prompt: snapshot.analysis_prompt,
    };
  }
}

/**
 * 配置快照解析工具，只暴露文本处理需要的字段
 */
export class TextProcessingConfigTool {
  /**
   * 从完整 config 快照抽取文本处理配置，缺失时使用设置领域默认值
   */
  public static from_api_value(value: JsonValue | undefined): TextProcessingConfig {
    const snapshot = normalize_setting_snapshot(value);
    return {
      source_language: snapshot.source_language,
      target_language: snapshot.target_language,
      clean_ruby: snapshot.clean_ruby,
      auto_process_prefix_suffix_preserved_text: snapshot.auto_process_prefix_suffix_preserved_text,
    };
  }
}
