import type { ApiJsonValue } from "../api/api-types";
import type { CacheReadPort } from "../cache/cache-types";
import type { TranslationFileExportService } from "../translation/translation-file-export-service";
import type { ProjectSessionState } from "../project/project-session";
import type { BackendWorkerClient } from "../worker/worker-client";
import { Item } from "../../domain/item";
import { normalize_text_preserve_mode } from "../../domain/quality";
import * as AppErrors from "../../shared/error";
import {
  build_ts_conversion_custom_rules,
  collect_ts_conversion_text_types,
  normalize_ts_conversion_items,
  type TsConversionDirection,
} from "../../shared/toolbox/ts-conversion";
import type { QualityRulePresetReader } from "../quality/quality-rule-preset-reader";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * ToolboxTsConversionExportService 生成繁简转换后的导出文件。
 */
export class ToolboxTsConversionExportService {
  private readonly session_state: ProjectSessionState; // session_state 校验当前导出项目身份。
  private readonly cache: CacheReadPort; // cache 提供 item 与文本保护规则快照。
  private readonly worker_client: BackendWorkerClient; // worker_client 执行繁简转换计算。
  private readonly preset_reader: QualityRulePresetReader; // preset_reader 读取内置文本保护规则。
  private readonly file_export_service: TranslationFileExportService; // file_export_service 负责真实文件写回。

  /**
   * 注入导出链路依赖，转换服务只编排数据和 worker 计算。
   */
  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: CacheReadPort;
    workerClient: BackendWorkerClient;
    presetReader: QualityRulePresetReader;
    fileExportService: TranslationFileExportService;
  }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.worker_client = options.workerClient;
    this.preset_reader = options.presetReader;
    this.file_export_service = options.fileExportService;
  }

  /**
   * 读取当前项目 item，执行繁简转换后交给翻译导出服务写文件。
   */
  public async export_files(request: JsonRecord): Promise<JsonRecord> {
    this.require_loaded_project_path();
    const direction = this.read_direction(request["direction"]);
    const convert_name = request["convert_name"] !== false;
    const preserve_text = request["preserve_text"] !== false;
    const source_items = this.cache.items.readItems();
    if (source_items.length === 0) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_ts_conversion_items" },
      });
    }
    const runtime_items = normalize_ts_conversion_items(source_items);
    const text_preserve = this.read_text_preserve_slice();
    const text_preserve_mode = normalize_text_preserve_mode(text_preserve.mode, "smart");
    const normalized_text_preserve_mode = text_preserve_mode.toLowerCase();
    const custom_rules = build_ts_conversion_custom_rules(text_preserve.entries);
    const preset_rules_by_text_type =
      preserve_text &&
      normalized_text_preserve_mode !== "off" &&
      normalized_text_preserve_mode !== "custom"
        ? this.read_preset_rules_by_text_type(collect_ts_conversion_text_types(runtime_items))
        : {};
    const converted_items = await this.worker_client.run(
      {
        type: "ts_conversion",
        input: {
          items: runtime_items,
          direction,
          convert_name,
          preserve_text,
          text_preserve_mode,
          custom_rules,
          preset_rules_by_text_type,
        },
      },
      new AbortController().signal,
    );
    const converted_by_id = new Map(
      converted_items.map((item) => {
        return [item.item_id, item] as const;
      }),
    );
    const export_items = source_items.map((item) => {
      const item_id = Number(item["item_id"] ?? item["id"] ?? 0);
      const converted = converted_by_id.get(item_id);
      return Item.from_json({
        ...item,
        ...(converted === undefined
          ? {}
          : {
              dst: converted.dst,
              name_dst: converted.name_dst,
            }),
      });
    });
    return this.file_export_service.export_items_with_suffix(
      export_items,
      direction === "s2t" ? "_S2T" : "_T2S",
    );
  }

  /**
   * 读取文本保护质量规则切片，缺失时回到 smart 空规则。
   */
  private read_text_preserve_slice(): {
    mode: string;
    entries: Array<Record<string, unknown>>;
  } {
    const quality_block = this.cache.quality.readBlock();
    const slice =
      typeof quality_block["text_preserve"] === "object" &&
      quality_block["text_preserve"] !== null &&
      !Array.isArray(quality_block["text_preserve"])
        ? (quality_block["text_preserve"] as Record<string, unknown>)
        : {};
    const entries = Array.isArray(slice["entries"])
      ? slice["entries"].flatMap((entry) => {
          return typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? [{ ...(entry as Record<string, unknown>) }]
            : [];
        })
      : [];
    return {
      mode: String(slice["mode"] ?? "smart"),
      entries,
    };
  }

  /**
   * 按当前项目出现的 text_type 读取内置保护规则。
   */
  private read_preset_rules_by_text_type(text_types: string[]): Record<string, string[]> {
    return Object.fromEntries(
      text_types.map((text_type) => {
        return [text_type, this.preset_reader.read_builtin_text_preserve_rule_sources(text_type)];
      }),
    );
  }

  /**
   * 校验繁简转换方向，非法值映射为请求参数错误。
   */
  private read_direction(value: ApiJsonValue | undefined): TsConversionDirection {
    if (value === "s2t" || value === "t2s") {
      return value;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_ts_conversion_direction" },
    });
  }

  /**
   * 导出必须依赖已加载项目，空会话直接抛出项目未加载错误。
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }
}
