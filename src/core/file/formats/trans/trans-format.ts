import path from "node:path";

import { JsonTool } from "../../../../shared/utils/json-tool";
import { Item } from "../../../../domain/item";
import { group_items, write_text_file, type ExportPaths } from "../file-format-shared";
import { KagTransProcessor } from "./processors/kag-processor";
import { RenPyTransProcessor } from "./processors/renpy-processor";
import { RPGMakerTransProcessor } from "./processors/rpgmaker-processor";
import { WolfTransProcessor } from "./processors/wolf-processor";
import {
  NoneTransProcessor,
  record_array,
  string_array,
  to_mutable_record,
  type ApiJsonRecord,
  type TransSnapshot,
} from "./trans-processor";
import { collect_patch_targets, patch_trans_row } from "./trans-patch-writer";

/**
 * TRANS 格式处理器，负责 .trans 的读入、引擎处理器选择和最小补丁写回
 */
export class TRANSFormat {
  /**
   * 读取 .trans project.files，以 data 行为权威并按同索引读取 tags/context/parameters
   */
  public read_from_stream(content: Uint8Array, rel_path: string): Item[] {
    const root = JsonTool.parseStrict<ApiJsonRecord>(content);
    if (typeof root !== "object" || root === null || Array.isArray(root)) {
      return [];
    }
    const project = to_mutable_record(root["project"]);
    const files = to_mutable_record(project["files"]);
    const index_original = this.non_negative_index(project["indexOriginal"], 0);
    const index_translation = this.non_negative_index(project["indexTranslation"], 1);
    const processor = this.get_processor(project);
    processor.pre_process();

    const items: Item[] = [];
    for (const [file_key, entry_raw] of Object.entries(files)) {
      const entry = to_mutable_record(entry_raw);
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
          Item.from_json({
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
            skip_internal_filter: checked.skip_internal_filter,
          }),
        );
      }
    }
    return items;
  }

  /**
   * 写回只使用 trans_ref 定位原始行，缺失定位信息直接拒绝写回
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

      const patch_targets = collect_patch_targets(snapshots, files);
      for (const target of patch_targets) {
        patch_trans_row(files, target, processor, index_translation);
      }
      project["files"] = files;
      root["project"] = project;
      await write_text_file(
        path.join(paths.translated_path, rel_path),
        JsonTool.stringifyStrict(root),
      );
    }
  }

  /**
   * 根据 gameEngine 选择历史同名处理器，未知引擎退回 NONE
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
      return new RPGMakerTransProcessor(project);
    }
    return new NoneTransProcessor(project);
  }

  /**
   * indexOriginal/indexTranslation 必须是非负整数，避免 JS 与历史负索引差异
   */
  private non_negative_index(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
  }
}
