import type { ItemStatus, ItemTextType } from "../../../../domain/item";
import { is_json_record, read_json_record, type MutableJsonRecord } from "../../../../domain/json";

/**
 * TRANS processor.check 的返回结构，保持旧 src/dst/tag/status/skip 顺序语义
 */
export interface TransCheckResult {
  src: string; // 归一后的源文
  dst: string; // 归一后的已有译文
  tag: string[]; // 原始 TRANS 标签
  status: ItemStatus; // 导入后的统一条目状态
  skip_internal_filter: boolean; // aqua 等强制翻译标记
}

/**
 * 写回前对 Item 做快照，避免后续补丁逻辑反复读取可变对象
 */
export interface TransSnapshot {
  row: number; // 工程内稳定全局行号
  file_key: string; // 原始 project.files 键
  src: string; // 写回前源文快照
  dst: string; // 写回前译文快照
  status: ItemStatus; // 决定是否采用译文
  extra_field: MutableJsonRecord; // 保存精确 trans_ref 与格式私有字段
}

/**
 * patch writer 定位到原始 .trans project.files[file_key].data[row_index] 的目标
 */
export interface PatchTarget {
  snap: TransSnapshot; // 待写回条目快照
  file_key: string; // 目标文件键
  row_index: number; // 目标 data 数组下标
}

/**
 * TRANS 过滤计算结果，统一承载标签、状态与分区写回判断
 */
export interface TransFilterEffect {
  block: boolean[]; // 各内部过滤器命中结果
  tag: string[]; // 写回条目保留的标签
  status: ItemStatus; // 过滤后的统一状态
  is_mixed_partition: boolean; // 是否只跳过混合分区中的部分内容
}

/**
 * derive_trans_filter_effect 的窄输入，parameter 只用于判断是否允许分区参数
 */
export interface TransFilterEffectInput {
  block: boolean[]; // 原始过滤器布尔数组
  tag: string[]; // 原始 TRANS 标签
  parameter?: unknown; // 可选分区参数，只在已知结构下读取
}

/**
 * 扩展名黑名单与旧 NONE.BLACKLIST_EXT 保持一致，只检查文本内容中的资源引用。
 */
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
export function record_array(value: unknown): MutableJsonRecord[] {
  return Array.isArray(value) ? value.filter(is_json_record) : [];
}

/**
 * 分区参数生成需要浅拷贝对象，避免就地污染原始 extra_field 引用
 */
export function trans_record_array(value: unknown): MutableJsonRecord[] {
  return Array.isArray(value)
    ? value.map((item) => read_json_record(item) as MutableJsonRecord)
    : [];
}

/**
 * 写回原始 JSON 时需要可变对象视图，非对象统一当作空对象处理
 */
export function to_mutable_record(value: unknown): MutableJsonRecord {
  return read_json_record(value) as MutableJsonRecord;
}

/**
 * 从过滤结果计算公开状态、gold 标签和分区参数资格，读入与写回必须共用同一口径
 */
export function derive_trans_filter_effect(input: TransFilterEffectInput): TransFilterEffect {
  const block = normalize_trans_filter_block(input.block);
  const has_blocked_partition = block.some(Boolean);
  const has_unblocked_partition = block.some((value) => !value);
  const is_mixed_block = has_blocked_partition && has_unblocked_partition;

  return {
    block,
    tag: derive_trans_filter_tag(input.tag, has_blocked_partition),
    status: has_unblocked_partition ? "NONE" : "EXCLUDED",
    is_mixed_partition: is_mixed_block && can_generate_trans_partition_parameter(input.parameter),
  };
}

/**
 * 空 block 在历史上代表没有过滤，归一后避免 every/any 空数组陷阱
 */
function normalize_trans_filter_block(block: boolean[]): boolean[] {
  return block.length === 0 ? [false] : block;
}

/**
 * gold 表示命中过自动过滤；没有任何过滤时移除计算 gold，保留 red/blue 的人工排除语义
 */
function derive_trans_filter_tag(tag: string[], has_blocked_partition: boolean): string[] {
  if (has_blocked_partition) {
    return tag.some((value) => value === "red" || value === "blue" || value === "gold")
      ? tag
      : [...tag, "gold"];
  }
  if (tag.includes("gold") && !has_color_block_tag(tag)) {
    return tag.filter((value) => value !== "gold");
  }
  return tag;
}

/**
 * span schema 表示 KAG/RENPY 等定位参数，不能被 TRANS 分区参数覆盖
 */
function can_generate_trans_partition_parameter(parameter: unknown): boolean {
  const parameter_list = Array.isArray(parameter) ? parameter : [];
  return has_trans_partition_parameter(parameter_list) || !has_trans_span_parameter(parameter_list);
}

/**
 * 已存在 contextStr/translation 时说明该行本来就是分区参数结构
 */
function has_trans_partition_parameter(parameter_list: unknown[]): boolean {
  return parameter_list.some(
    (value) => is_json_record(value) && ("contextStr" in value || "translation" in value),
  );
}

/**
 * start/end/enclosure/lineIndent 属于 span 定位结构，不承载 TRANS 分区语义
 */
function has_trans_span_parameter(parameter_list: unknown[]): boolean {
  return parameter_list.some(
    (value) =>
      is_json_record(value) &&
      ("start" in value || "end" in value || "enclosure" in value || "lineIndent" in value),
  );
}

/**
 * TRANS 默认处理器，对齐旧 NONE：只按资源扩展名和颜色标签过滤
 */
export class NoneTransProcessor {
  /**
   * project 保存完整 .trans 工程对象；仅复用默认过滤规则时可直接指定文本类型。
   */
  public constructor(
    protected readonly project: MutableJsonRecord,
    public readonly text_type: ItemTextType = "NONE",
  ) {}

  /**
   * 默认处理器无需预处理；子类可构建缓存
   */
  public pre_process(): void {}

  /**
   * 默认处理器无需后处理；写回前由子类刷新缓存
   */
  public post_process(): void {}

  /**
   * 判断一行 .trans 数据的状态，并维护计算 gold 标签与 aqua 跳过语义
   */
  public check(
    path_key: string,
    data: [string, string],
    tag: string[],
    context: string[],
  ): TransCheckResult {
    const src = typeof data[0] === "string" ? data[0] : "";
    const dst = typeof data[1] === "string" ? data[1] : "";

    if (src === "") {
      return { src, dst, tag, status: "EXCLUDED", skip_internal_filter: false };
    }
    if (tag.some((value) => value === "aqua")) {
      return { src, dst, tag, status: "NONE", skip_internal_filter: true };
    }
    if (dst !== "" && src !== dst) {
      return { src, dst, tag, status: "PROCESSED", skip_internal_filter: false };
    }

    const effect = derive_trans_filter_effect({
      block: this.filter(src, path_key, tag, context),
      tag,
    });

    return {
      src,
      dst,
      tag: effect.tag,
      status: effect.status,
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
  ): MutableJsonRecord[] {
    if (block.every((value) => value === true) || block.every((value) => value === false)) {
      return record_array(parameter);
    }
    if (!can_generate_trans_partition_parameter(parameter)) {
      return record_array(parameter);
    }

    const parameter_list = Array.isArray(parameter) ? parameter : [];
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
