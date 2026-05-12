// 文本处理层只接受可序列化 JSON 值，避免 worker 与主线程共享可变对象实例
export type TextJsonValue =
  | null
  | boolean
  | number
  | string
  | TextJsonValue[]
  | { [key: string]: TextJsonValue };

/**
 * worker 侧可消费的普通 JSON 对象，避免把数据库对象引用传入 worker
 */
export type TextJsonRecord = Record<string, TextJsonValue>;

/**
 * 文本处理只依赖的配置字段，字段名保持配置快照兼容
 */
export interface TextProcessingConfig {
  source_language: string; // 源/目标语言直接来自项目配置，语言过滤器负责未知值兜底
  target_language: string;
  clean_ruby: boolean; // clean_ruby 控制是否剥离注音标记，保持与导入格式处理器解耦
  check_kana_residue: boolean; // 残留和相似度检查按开关独立启用，便于旧项目逐步迁移质量规则
  check_hangeul_residue: boolean;
  check_similarity: boolean;
  auto_process_prefix_suffix_preserved_text: boolean; // 自动保护前后缀开关决定完全保护行是否仍进入翻译流程
}

/**
 * 质量规则快照归一后只保留 worker 必须知道的稳定事实
 */
export interface TextQualitySnapshot {
  glossary_enable: boolean; // glossary 与 replacement 规则均为运行时快照，worker 不回读数据库
  glossary_entries: TextJsonRecord[];
  text_preserve_mode: string;
  text_preserve_entries: TextJsonRecord[];
  pre_replacement_enable: boolean;
  pre_replacement_entries: TextJsonRecord[];
  post_replacement_enable: boolean;
  post_replacement_entries: TextJsonRecord[];
  translation_prompt_enable: boolean; // prompt 字段来自提示词设置页，PromptBuilder 负责与资源模板合并
  translation_prompt: string;
  analysis_prompt_enable: boolean;
  analysis_prompt: string;
}

/**
 * 任务 item 的最小形状，runner 只按这些字段读写翻译事实
 */
export type TextTaskItemRecord = TextJsonRecord & {
  id?: number; // id/item_id 同时兼容数据库行和前端运行态条目
  item_id?: number;
  src?: string; // src/dst/status 是翻译提交的核心事实，其余字段只辅助处理
  dst?: string;
  name_src?: string | string[] | null;
  name_dst?: string | string[] | null;
  status?: string;
  text_type?: string; // text_type 决定保护规则分支，retry_count 用于任务调度诊断
  retry_count?: number;
  extra_field?: TextJsonValue; // extra_field 保留格式处理器回写所需的结构化上下文
};

/**
 * 质量快照解析工具，集中兼容嵌套 payload 和旧扁平字段
 */
export class TextQualitySnapshotTool {
  /**
   * 从 API JSON 恢复成不可变值对象；缺失字段按“规则关闭”处理
   */
  public static from_api_value(value: TextJsonValue | undefined): TextQualitySnapshot {
    const root = this.read_record(value);
    const quality = this.read_record(root["quality"]);
    const prompts = this.read_record(root["prompts"]);
    const glossary = this.read_record(quality["glossary"]);
    const text_preserve = this.read_record(quality["text_preserve"]);
    const pre_replacement = this.read_record(quality["pre_replacement"]);
    const post_replacement = this.read_record(quality["post_replacement"]);
    const translation = this.read_record(prompts["translation"]);
    const analysis = this.read_record(prompts["analysis"]);
    return {
      glossary_enable: this.read_boolean(glossary["enabled"], true),
      glossary_entries: this.read_record_list(glossary["entries"]),
      text_preserve_mode: this.read_string(text_preserve["mode"], "OFF"),
      text_preserve_entries: this.read_record_list(text_preserve["entries"]),
      pre_replacement_enable: this.read_boolean(pre_replacement["enabled"], false),
      pre_replacement_entries: this.read_record_list(pre_replacement["entries"]),
      post_replacement_enable: this.read_boolean(post_replacement["enabled"], false),
      post_replacement_entries: this.read_record_list(post_replacement["entries"]),
      translation_prompt_enable: this.read_boolean(translation["enabled"], false),
      translation_prompt: this.read_string(translation["text"], ""),
      analysis_prompt_enable: this.read_boolean(analysis["enabled"], false),
      analysis_prompt: this.read_string(analysis["text"], ""),
    };
  }

  /**
   * 普通对象归一，保证数组和 null 不会被当作配置字典
   */
  private static read_record(value: TextJsonValue | undefined): TextJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 规则列表只保留普通对象项，避免坏 JSON 污染正则拼接
   */
  private static read_record_list(value: TextJsonValue | undefined): TextJsonRecord[] {
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is TextJsonRecord =>
              typeof item === "object" && item !== null && !Array.isArray(item),
          )
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 布尔字段只接受真实 boolean，字符串由调用方显式迁移后再传入
   */
  private static read_boolean(value: TextJsonValue | undefined, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  /**
   * 文本字段统一转字符串，保持旧配置中数字误填也能可见地参与替换
   */
  private static read_string(value: TextJsonValue | undefined, fallback: string): string {
    return value === undefined || value === null ? fallback : String(value);
  }
}

/**
 * 配置快照解析工具，只暴露文本处理需要的字段
 */
export class TextProcessingConfigTool {
  /**
   * 从完整 config 快照抽取文本处理配置，缺失时使用内置默认值
   */
  public static from_api_value(value: TextJsonValue | undefined): TextProcessingConfig {
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    return {
      source_language: this.read_string(record["source_language"], "JA"),
      target_language: this.read_string(record["target_language"], "ZH"),
      clean_ruby: this.read_boolean(record["clean_ruby"], false),
      check_kana_residue: this.read_boolean(record["check_kana_residue"], true),
      check_hangeul_residue: this.read_boolean(record["check_hangeul_residue"], true),
      check_similarity: this.read_boolean(record["check_similarity"], true),
      auto_process_prefix_suffix_preserved_text: this.read_boolean(
        record["auto_process_prefix_suffix_preserved_text"],
        true,
      ),
    };
  }

  /**
   * 布尔字段不做字符串猜测，避免 `"false"` 被误当启用
   */
  private static read_boolean(value: TextJsonValue | undefined, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  /**
   * 语言码字段保持大写字符串，未知值交给具体过滤器兜底
   */
  private static read_string(value: TextJsonValue | undefined, fallback: string): string {
    return typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : fallback;
  }
}
