import type { ApiJsonValue } from "../../../api/api-types";
import { read_json_record, type ItemStatus, type ItemTextType } from "../../../../base/item";

export type ApiJsonRecord = Record<string, ApiJsonValue>;

/**
 * TRANS processor.check 的返回结构，保持旧 src/dst/tag/status/skip 顺序语义
 */
export interface TransCheckResult {
  src: string;
  dst: string;
  tag: string[];
  status: ItemStatus;
  skip_internal_filter: boolean;
}

/**
 * 写回前对 Item 做快照，避免后续补丁逻辑反复读取可变对象
 */
export interface TransSnapshot {
  row: number;
  file_key: string;
  src: string;
  dst: string;
  status: ItemStatus;
  extra_field: ApiJsonRecord;
}

/**
 * patch writer 定位到原始 .trans project.files[file_key].data[row_index] 的目标
 */
export interface PatchTarget {
  snap: TransSnapshot;
  file_key: string;
  row_index: number;
}

// 扩展名黑名单与旧 NONE.BLACKLIST_EXT 保持一致，只检查文本内容中的资源引用
export const BLACKLIST_EXTENSIONS = [
  ".mp3", // 音频资源引用
  ".wav", // 音频资源引用
  ".ogg", // 音频资源引用
  ".mid", // MIDI 音频资源引用
  ".png", // 图片资源引用
  ".jpg", // 图片资源引用
  ".jpeg", // 图片资源引用
  ".gif", // 图片资源引用
  ".psd", // 图片工程源文件引用
  ".webp", // 图片资源引用
  ".heif", // 图片资源引用
  ".heic", // 图片资源引用
  ".avi", // 视频资源引用
  ".mp4", // 视频资源引用
  ".webm", // 视频资源引用
  ".txt", // 外部文本资源路径
  ".7z", // 压缩包资源引用
  ".gz", // 压缩包资源引用
  ".rar", // 压缩包资源引用
  ".zip", // 压缩包资源引用
  ".json", // 数据文件路径引用
  ".sav", // 存档文件路径引用
  ".mps", // RPG Maker 资源文件引用
  ".ttf", // 字体资源引用
  ".otf", // 字体资源引用
  ".woff", // Web 字体资源引用
] as const;

/**
 * red/blue 是 trans 系列处理器共同的强制排除色标
 */
export function has_color_block_tag(tag: string[]): boolean {
  return tag.some((value) => value === "red" || value === "blue");
}

/**
 * 从未知 JSON 值读取字符串数组，非字符串元素直接忽略
 */
export function string_array(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * 读取参数对象数组，保持 extra_field.parameter 只含普通对象
 */
export function record_array(value: unknown): ApiJsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ApiJsonRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

/**
 * 分区参数生成需要浅拷贝对象，避免就地污染原始 extra_field 引用
 */
export function trans_record_array(value: unknown): ApiJsonRecord[] {
  return Array.isArray(value) ? value.map((item) => read_json_record(item) as ApiJsonRecord) : [];
}

/**
 * 写回原始 JSON 时需要可变对象视图，非对象统一当作空对象处理
 */
export function to_mutable_record(value: unknown): ApiJsonRecord {
  return read_json_record(value) as ApiJsonRecord;
}

/**
 * TRANS 默认处理器，对齐旧 NONE：只按资源扩展名和颜色标签过滤
 */
export class NoneTransProcessor {
  public readonly text_type: ItemTextType = "NONE";

  /**
   * project 保存完整 .trans 工程对象，供子类生成过滤缓存
   */
  public constructor(protected readonly project: ApiJsonRecord) {}

  /**
   * 默认处理器无需预处理；子类可构建缓存
   */
  public pre_process(): void {}

  /**
   * 默认处理器无需后处理；写回前由子类刷新缓存
   */
  public post_process(): void {}

  /**
   * 判断一行 .trans 数据的状态，并维护派生 gold 标签与 aqua 跳过语义
   */
  public check(
    path_key: string,
    data: [string, string],
    tag: string[],
    context: string[],
  ): TransCheckResult {
    const src = typeof data[0] === "string" ? data[0] : "";
    const dst = typeof data[1] === "string" ? data[1] : "";
    let updated_tag = tag;

    if (src === "") {
      return { src, dst, tag: updated_tag, status: "EXCLUDED", skip_internal_filter: false };
    }
    if (updated_tag.some((value) => value === "aqua")) {
      return { src, dst, tag: updated_tag, status: "NONE", skip_internal_filter: true };
    }
    if (dst !== "" && src !== dst) {
      return { src, dst, tag: updated_tag, status: "PROCESSED", skip_internal_filter: false };
    }

    let block = this.filter(src, path_key, updated_tag, context);
    if (block.length === 0) {
      block = [false];
    }

    const is_all_blocked = block.every(Boolean);
    const is_all_unblocked = block.every((value) => !value);
    const is_mixed = !is_all_blocked && !is_all_unblocked;

    if (
      is_mixed &&
      !updated_tag.some((value) => value === "red" || value === "blue" || value === "gold")
    ) {
      updated_tag = [...updated_tag, "gold"];
    } else if (!is_mixed && updated_tag.includes("gold") && !has_color_block_tag(updated_tag)) {
      updated_tag = updated_tag.filter((value) => value !== "gold");
    }

    return {
      src,
      dst,
      tag: updated_tag,
      status: block.some((value) => !value) ? "NONE" : "EXCLUDED",
      skip_internal_filter: false,
    };
  }

  /**
   * 默认过滤只看文本资源扩展名和 red/blue 标签，context 仅决定返回分区数量
   */
  public filter(src: string, _path_key: string, tag: string[], context: string[]): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }
    return Array.from({ length }, () => has_color_block_tag(tag));
  }

  /**
   * 混合分区时生成 contextStr/translation 参数，span schema 保持原样
   */
  public generate_parameter(
    src: string,
    context: string[],
    parameter: unknown,
    block: boolean[],
  ): ApiJsonRecord[] {
    if (block.every((value) => value === true) || block.every((value) => value === false)) {
      return record_array(parameter);
    }

    const parameter_list = Array.isArray(parameter) ? parameter : [];
    const has_partition = parameter_list.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        ("contextStr" in value || "translation" in value),
    );
    const has_span = parameter_list.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        ("start" in value || "end" in value || "enclosure" in value || "lineIndent" in value),
    );
    if (has_span && !has_partition) {
      return record_array(parameter_list);
    }

    const result = trans_record_array(parameter_list);
    for (const [index, is_blocked] of block.entries()) {
      while (index >= result.length) {
        result.push({});
      }
      result[index]["contextStr"] = context[index] ?? "";
      result[index]["translation"] = is_blocked ? src : "";
    }
    return result;
  }
}
