import path from "node:path";

import type { ApiJsonValue } from "../../api/api-types";
import { JsonTool } from "../../../shared/utils/json-tool";
import { group_items, write_text_file, type ExportPaths } from "./file-format-shared";
import {
  normalize_item,
  read_json_record,
  type Item,
  type ItemStatus,
  type ItemTextType,
} from "../../../base/item";

type ApiJsonRecord = Record<string, ApiJsonValue>;

/**
 * TRANS processor.check 的返回结构，保持旧 src/dst/tag/status/skip 顺序语义。
 */
interface TransCheckResult {
  src: string;
  dst: string;
  tag: string[];
  status: ItemStatus;
  skip_internal_filter: boolean;
}

/**
 * 写回前对 Item 做快照，避免后续补丁逻辑反复读取可变对象。
 */
interface TransSnapshot {
  row: number;
  file_key: string;
  src: string;
  dst: string;
  status: ItemStatus;
  extra_field: ApiJsonRecord;
}

/**
 * patch writer 定位到原始 .trans project.files[file_key].data[row_index] 的目标。
 */
interface PatchTarget {
  snap: TransSnapshot;
  file_key: string;
  row_index: number;
}

// 扩展名黑名单与旧 NONE.BLACKLIST_EXT 保持一致，只检查文本内容中的资源引用。
const BLACKLIST_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".mid",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".psd",
  ".webp",
  ".heif",
  ".heic",
  ".avi",
  ".mp4",
  ".webm",
  ".txt",
  ".7z",
  ".gz",
  ".rar",
  ".zip",
  ".json",
  ".sav",
  ".mps",
  ".ttf",
  ".otf",
  ".woff",
] as const;

/**
 * red/blue 是 trans 系列处理器共同的强制排除色标。
 */
function has_color_block_tag(tag: string[]): boolean {
  return tag.some((value) => value === "red" || value === "blue");
}

/**
 * 从未知 JSON 值读取字符串数组，非字符串元素直接忽略。
 */
function string_array(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * 读取参数对象数组，保持 extra_field.parameter 只含普通对象。
 */
function record_array(value: unknown): ApiJsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ApiJsonRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

/**
 * 分区参数生成需要浅拷贝对象，避免就地污染原始 extra_field 引用。
 */
function trans_record_array(value: unknown): ApiJsonRecord[] {
  return Array.isArray(value) ? value.map((item) => read_json_record(item) as ApiJsonRecord) : [];
}

/**
 * 写回原始 JSON 时需要可变对象视图，非对象统一当作空对象处理。
 */
function to_mutable_record(value: unknown): ApiJsonRecord {
  return read_json_record(value) as ApiJsonRecord;
}

/**
 * TRANS 默认处理器，对齐旧 NONE：只按资源扩展名和颜色标签过滤。
 */
class NoneTransProcessor {
  public readonly text_type: ItemTextType = "NONE";

  /**
   * project 保存完整 .trans 工程对象，供子类生成过滤缓存。
   */
  public constructor(protected readonly project: ApiJsonRecord) {}

  /**
   * 默认处理器无需预处理；子类可构建缓存。
   */
  public pre_process(): void {}

  /**
   * 默认处理器无需后处理；写回前由子类刷新缓存。
   */
  public post_process(): void {}

  /**
   * 判断一行 .trans 数据的状态，并维护派生 gold 标签与 aqua 跳过语义。
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
   * 默认过滤只看文本资源扩展名和 red/blue 标签，context 仅决定返回分区数量。
   */
  public filter(src: string, _path_key: string, tag: string[], context: string[]): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }
    return Array.from({ length }, () => has_color_block_tag(tag));
  }

  /**
   * 混合分区时生成 contextStr/translation 参数，span schema 保持原样。
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

/**
 * KAG .trans 只改变 text_type，过滤逻辑继承 NONE。
 */
class KagTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "KAG";
}

/**
 * RENPY .trans 只改变 text_type，过滤逻辑继承 NONE。
 */
class RenPyTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "RENPY";
}

/**
 * RPG Maker .trans 在默认过滤上叠加路径和地址黑名单。
 */
class RpgMakerTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "RPGMAKER";

  private static readonly BLACKLIST_PATH = [/\.js$/iu];

  private static readonly BLACKLIST_ADDRESS = [
    /^(?=.*MZ Plugin Command)(?!.*text).*/iu,
    /filename/iu,
    /\/events\/\d+\/name/iu,
    /Tilesets\/\d+\/name/iu,
    /MapInfos\/\d+\/name/iu,
    /Animations\/\d+\/name/iu,
    /CommonEvents\/\d+\/name/iu,
  ] as const;

  private cached_path = "";
  private cached_path_blocked = false;

  /**
   * 路径黑名单按 file_key 缓存，地址黑名单逐 context 判断。
   */
  public override filter(
    src: string,
    path_key: string,
    tag: string[],
    context: string[],
  ): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }

    if (this.cached_path !== path_key) {
      this.cached_path = path_key;
      this.cached_path_blocked = RpgMakerTransProcessor.BLACKLIST_PATH.some((rule) =>
        rule.test(path_key),
      );
    }
    if (this.cached_path_blocked) {
      return Array.from({ length }, () => true);
    }

    if (context.length === 0) {
      return [has_color_block_tag(tag)];
    }

    return context.map((address) => {
      if (has_color_block_tag(tag)) {
        return true;
      }
      return RpgMakerTransProcessor.BLACKLIST_ADDRESS.some((rule) => rule.test(address));
    });
  }
}

/**
 * WOLF .trans 使用地址白名单/黑名单和数据库屏蔽文本集合。
 */
class WolfTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "WOLF";

  private static readonly WHITELIST_ADDRESS = [
    /\/Database\/stringArgs\/0$/iu,
    /\/CommonEvent\/stringArgs\/\d*[1-9]\d*$/iu,
    /\/CommonEventByName\/stringArgs\/\d*[1-9]\d*$/iu,
    /\/Message\/stringArgs\/\d+$/iu,
    /\/Picture\/stringArgs\/\d+$/iu,
    /\/Choices\/stringArgs\/\d+$/iu,
    /\/SetString\/stringArgs\/\d+$/iu,
    /\/StringCondition\/stringArgs\/\d+$/iu,
  ] as const;

  private static readonly BLACKLIST_ADDRESS = [
    /\/Database\/stringArgs\/\d*[1-9]\d*$/iu,
    /\/CommonEvent\/stringArgs\/0$/iu,
    /\/CommonEventByName\/stringArgs\/0$/iu,
    /\/name$/iu,
    /\/description$/iu,
    /\/Comment\/stringArgs\//iu,
    /\/DebugMessage\/stringArgs\//iu,
  ] as const;

  private block_text = new Set<string>();

  /**
   * 读取前根据整个 project 生成被数据库地址遮蔽的文本集合。
   */
  public override pre_process(): void {
    this.block_text = this.generate_block_text(this.project);
  }

  /**
   * 写回前重新生成屏蔽集合，避免原始 project 被外部修改后缓存过期。
   */
  public override post_process(): void {
    this.block_text = this.generate_block_text(this.project);
  }

  /**
   * WOLF 先应用白名单，再应用黑名单、色标、common 路径和屏蔽文本。
   */
  public override filter(
    src: string,
    _path_key: string,
    tag: string[],
    context: string[],
  ): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }

    if (context.length === 0) {
      return [has_color_block_tag(tag)];
    }

    return context.map((address) => {
      if (WolfTransProcessor.WHITELIST_ADDRESS.some((rule) => rule.test(address))) {
        return false;
      }
      if (WolfTransProcessor.BLACKLIST_ADDRESS.some((rule) => rule.test(address))) {
        return true;
      }
      if (has_color_block_tag(tag)) {
        return true;
      }
      if (/^common\//iu.test(address)) {
        return true;
      }
      if (
        /DataBase\.json\/types\/\d+\/data\/\d+\/data\/\d+\/value/iu.test(address) &&
        this.block_text.has(src)
      ) {
        return true;
      }
      return false;
    });
  }

  /**
   * 从 WOLF 数据库 stringArgs 非 0 项收集应屏蔽文本，对齐旧 generate_block_text。
   */
  private generate_block_text(project: ApiJsonRecord): Set<string> {
    const result = new Set<string>();
    const files = read_json_record(project["files"]);
    for (const entry_raw of Object.values(files)) {
      const entry = read_json_record(entry_raw);
      const data_list = Array.isArray(entry["data"]) ? entry["data"] : [];
      const context_list = Array.isArray(entry["context"]) ? entry["context"] : [];
      const max_length = Math.max(data_list.length, context_list.length);
      for (let index = 0; index < max_length; index += 1) {
        const data_items = string_array(data_list[index]);
        const context_items = string_array(context_list[index]);
        if (data_items.length === 0) {
          continue;
        }
        if (/\/Database\/stringArgs\/\d*[1-9]\d*$/iu.test(context_items.join("\n"))) {
          result.add(data_items[0]);
        }
      }
    }
    return result;
  }
}

/**
 * TRANS 格式处理器，负责 .trans 的读入、引擎处理器选择和最小补丁写回。
 */
export class TRANSFormat {
  /**
   * 读取 .trans project.files，以 data 行为权威并按同索引读取 tags/context/parameters。
   */
  public read_from_stream(content: Uint8Array, rel_path: string): Item[] {
    const root = JsonTool.parseStrict<ApiJsonRecord>(content);
    if (typeof root !== "object" || root === null || Array.isArray(root)) {
      return [];
    }
    const project = read_json_record(root["project"]);
    const files = read_json_record(project["files"]);
    const index_original = this.non_negative_index(project["indexOriginal"], 0);
    const index_translation = this.non_negative_index(project["indexTranslation"], 1);
    const processor = this.get_processor(project as ApiJsonRecord);
    processor.pre_process();

    const items: Item[] = [];
    for (const [file_key, entry_raw] of Object.entries(files)) {
      const entry = read_json_record(entry_raw);
      const data_list = Array.isArray(entry["data"]) ? entry["data"] : [];
      const tags_list = Array.isArray(entry["tags"]) ? entry["tags"] : [];
      const context_list = Array.isArray(entry["context"]) ? entry["context"] : [];
      const parameters_list = Array.isArray(entry["parameters"]) ? entry["parameters"] : [];
      for (const [row_index, data_raw] of data_list.entries()) {
        const data_row = Array.isArray(data_raw) ? data_raw : [];
        const src = typeof data_row[index_original] === "string" ? data_row[index_original] : "";
        const dst =
          typeof data_row[index_translation] === "string" ? data_row[index_translation] : "";
        const tag = string_array(tags_list[row_index]);
        const context = string_array(context_list[row_index]);
        const parameter = record_array(parameters_list[row_index]);
        const checked = processor.check(file_key, [src, dst], tag, context);
        items.push(
          normalize_item({
            src: checked.src,
            dst: checked.dst,
            extra_field: {
              tag: checked.tag,
              context,
              parameter,
              trans_ref: { file_key, row_index },
            },
            tag: file_key,
            row: items.length,
            file_type: "TRANS",
            file_path: rel_path,
            text_type: processor.text_type,
            status: checked.status,
          }),
        );
      }
    }
    return items;
  }

  /**
   * 写回优先使用 trans_ref 最小补丁；缺失定位信息时回退旧重建路径。
   */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "TRANS")) {
      const original = asset_reader(rel_path);
      if (original === null) {
        continue;
      }

      const root = JsonTool.parseStrict<ApiJsonRecord>(original);
      if (typeof root !== "object" || root === null || Array.isArray(root)) {
        continue;
      }
      const project = to_mutable_record(root["project"]);
      const files = to_mutable_record(project["files"]);
      const index_original = this.non_negative_index(project["indexOriginal"], 0);
      const index_translation = this.non_negative_index(project["indexTranslation"], 1);
      const processor = this.get_processor(project);
      processor.post_process();

      const snapshots = group.map((item): TransSnapshot => {
        const extra_field = to_mutable_record(item.extra_field);
        return {
          row: item.row,
          file_key: item.tag,
          src: item.src,
          dst: item.dst,
          status: item.status,
          extra_field,
        };
      });

      const patch_result = this.collect_patch_targets(snapshots, files);
      if (patch_result.can_patch) {
        for (const target of patch_result.targets) {
          this.patch_trans_row(files, target, processor, index_translation);
        }
        project["files"] = files;
        root["project"] = project;
        await write_text_file(
          path.join(paths.translated_path, rel_path),
          JsonTool.stringifyStrict(root),
        );
        continue;
      }

      this.write_legacy_fallback(files, snapshots, processor, index_original, index_translation);
      project["files"] = files;
      root["project"] = project;
      await write_text_file(
        path.join(paths.translated_path, rel_path),
        JsonTool.stringifyStrict(root),
      );
    }
  }

  /**
   * 校验所有条目都能通过 trans_ref 定位原始数据行，任一失败就走 legacy fallback。
   */
  private collect_patch_targets(
    snapshots: TransSnapshot[],
    files: ApiJsonRecord,
  ): { can_patch: true; targets: PatchTarget[] } | { can_patch: false; targets: [] } {
    const targets: PatchTarget[] = [];
    for (const snap of snapshots) {
      const trans_ref = read_json_record(snap.extra_field["trans_ref"]);
      const file_key = trans_ref["file_key"];
      const row_index = trans_ref["row_index"];
      if (
        typeof file_key !== "string" ||
        typeof row_index !== "number" ||
        !Number.isInteger(row_index)
      ) {
        return { can_patch: false, targets: [] };
      }
      const entry = read_json_record(files[file_key]);
      const data_list = Array.isArray(entry["data"]) ? entry["data"] : null;
      if (data_list === null || row_index < 0 || row_index >= data_list.length) {
        return { can_patch: false, targets: [] };
      }
      targets.push({ snap, file_key, row_index });
    }
    return { can_patch: true, targets };
  }

  /**
   * 对单行执行最小补丁：必要时更新 tags/parameters，PROCESSED 才写译文列。
   */
  private patch_trans_row(
    files: ApiJsonRecord,
    target: PatchTarget,
    processor: NoneTransProcessor,
    index_translation: number,
  ): void {
    const entry = to_mutable_record(files[target.file_key]);
    const tag_row = this.read_row_string_array(entry["tags"], target.row_index);
    const context_row = this.read_row_string_array(entry["context"], target.row_index);
    const parameter_row = this.read_row_value(entry["parameters"], target.row_index);
    let block = processor.filter(target.snap.src, target.file_key, tag_row, context_row);
    if (block.length === 0) {
      block = [false];
    }

    const is_all_blocked = block.every(Boolean);
    const is_all_unblocked = block.every((value) => !value);
    const is_mixed_block = !is_all_blocked && !is_all_unblocked;
    const parameter_list_for_schema = Array.isArray(parameter_row) ? parameter_row : [];
    const has_partition = parameter_list_for_schema.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        ("contextStr" in value || "translation" in value),
    );
    const has_span = parameter_list_for_schema.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        ("start" in value || "end" in value || "enclosure" in value || "lineIndent" in value),
    );
    const is_span_schema = has_span && !has_partition;
    const is_mixed_partition = is_mixed_block && !is_span_schema;

    let new_tags = tag_row;
    if (
      is_mixed_partition &&
      !tag_row.some((value) => value === "red" || value === "blue" || value === "gold")
    ) {
      new_tags = [...tag_row, "gold"];
    } else if (!is_mixed_partition && tag_row.includes("gold") && !has_color_block_tag(tag_row)) {
      new_tags = tag_row.filter((value) => value !== "gold");
    }
    if (new_tags !== tag_row) {
      const tags_field = this.ensure_array_field(entry, "tags");
      while (tags_field.length <= target.row_index) {
        tags_field.push([]);
      }
      tags_field[target.row_index] = new_tags;
    }

    if (is_mixed_partition) {
      const parameters_field = this.ensure_array_field(entry, "parameters");
      while (parameters_field.length <= target.row_index) {
        parameters_field.push(null);
      }
      parameters_field[target.row_index] = processor.generate_parameter(
        target.snap.src,
        context_row,
        parameter_row,
        block,
      );
    }

    if (target.snap.status !== "PROCESSED") {
      files[target.file_key] = entry;
      return;
    }

    const data_list = this.ensure_array_field(entry, "data");
    if (target.row_index >= data_list.length) {
      files[target.file_key] = entry;
      return;
    }
    const row_raw = data_list[target.row_index];
    const row = Array.isArray(row_raw) ? row_raw : [];
    while (row.length <= index_translation) {
      row.push("");
    }
    row[index_translation] = target.snap.dst;
    data_list[target.row_index] = row;
    files[target.file_key] = entry;
  }

  /**
   * 兼容缺失 trans_ref 的旧条目，只重建本次 items 涉及的 file_key。
   */
  private write_legacy_fallback(
    files: ApiJsonRecord,
    snapshots: TransSnapshot[],
    processor: NoneTransProcessor,
    index_original: number,
    index_translation: number,
  ): void {
    const sorted_snapshots = [...snapshots].sort((left, right) => left.row - right.row);
    const tag_group = new Map<string, TransSnapshot[]>();
    for (const snap of sorted_snapshots) {
      const group = tag_group.get(snap.file_key) ?? [];
      group.push(snap);
      tag_group.set(snap.file_key, group);
    }

    for (const [file_key, snaps_by_key] of tag_group) {
      const entry = to_mutable_record(files[file_key]);
      const tags_out: string[][] = [];
      const data_out: string[][] = [];
      const context_out: string[][] = [];
      const parameters_out: ApiJsonRecord[][] = [];

      for (const snap of snaps_by_key) {
        const row = Array.from(
          { length: Math.max(index_original, index_translation) + 1 },
          () => "",
        );
        row[index_original] = snap.src;
        row[index_translation] = snap.dst;
        data_out.push(row);

        const tag = string_array(snap.extra_field["tag"]);
        const context = string_array(snap.extra_field["context"]);
        const parameter = snap.extra_field["parameter"];
        tags_out.push(tag);
        context_out.push(context);

        if (snap.status === "EXCLUDED") {
          parameters_out.push(record_array(parameter));
        } else {
          parameters_out.push(
            processor.generate_parameter(
              snap.src,
              context,
              parameter,
              processor.filter(snap.src, file_key, tag, context),
            ),
          );
        }
      }

      entry["tags"] = tags_out;
      entry["data"] = data_out;
      entry["context"] = context_out;
      entry["parameters"] = parameters_out;
      files[file_key] = entry;
    }
  }

  /**
   * 根据 gameEngine 选择历史同名处理器，未知引擎退回 NONE。
   */
  private get_processor(project: ApiJsonRecord): NoneTransProcessor {
    const engine = String(project["gameEngine"] ?? "").toLowerCase();
    if (engine === "kag" || engine === "vntrans") {
      return new KagTransProcessor(project);
    }
    if (engine === "wolf" || engine === "wolfrpg") {
      return new WolfTransProcessor(project);
    }
    if (engine === "renpy") {
      return new RenPyTransProcessor(project);
    }
    if (["2k", "2k3", "rmjdb", "rmxp", "rmvx", "rmvxace", "rmmv", "rmmz"].includes(engine)) {
      return new RpgMakerTransProcessor(project);
    }
    return new NoneTransProcessor(project);
  }

  /**
   * indexOriginal/indexTranslation 必须是非负整数，避免 JS 与历史负索引差异。
   */
  private non_negative_index(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  /**
   * 从行级二维字段读取字符串数组，缺失行直接为空。
   */
  private read_row_string_array(value: ApiJsonValue | undefined, row_index: number): string[] {
    const rows = Array.isArray(value) ? value : [];
    return string_array(rows[row_index]);
  }

  /**
   * 从行级二维字段读取原始 JSON 值，供参数 schema 探测使用。
   */
  private read_row_value(
    value: ApiJsonValue | undefined,
    row_index: number,
  ): ApiJsonValue | undefined {
    const rows = Array.isArray(value) ? value : [];
    return rows[row_index];
  }

  /**
   * 写回可选数组字段时就地补齐字段，保持原始 JSON 对象最小变更。
   */
  private ensure_array_field(record: ApiJsonRecord, field: string): ApiJsonValue[] {
    const value = record[field];
    if (Array.isArray(value)) {
      return value;
    }
    const replacement: ApiJsonValue[] = [];
    record[field] = replacement;
    return replacement;
  }
}
