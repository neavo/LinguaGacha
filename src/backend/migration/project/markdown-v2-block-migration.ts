import { Item, is_item_status, type ItemStatus } from "../../../domain/item";
import { read_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import {
  parse_markdown_v2_document,
  type MarkdownV2Unit,
} from "../../file/markdown/md-v2-document";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../../database/database-operations";
import {
  build_translation_extras_from_items,
  derive_project_item_view_record_from_public,
  type ProjectItemViewRecord,
} from "../../project/project-write-state";
import { replace_project_file_items } from "./project-file-item-replacement";

const LEGACY_MARKDOWN_FILE_TYPE = "MD";

type LegacyMarkdownItem = {
  id: number;
  src: string;
  dst: string;
  resolved_dst: string;
  row: number;
  file_path: string;
  status: ItemStatus;
  skip_internal_filter: boolean;
};

/**
 * 迁移背景：
 * 历史 Markdown Item 按物理行保存，当前 reader/writer 采用 AST 块和格式片段。
 *
 * 生效场景：
 * 打开时识别旧 `MD`，验证连续行号后重建源译文块，迁移重复译文、聚合状态和强制过滤标记，重建统计并推进修订号。
 * 提交时重读事务当前集合，只替换目标文件。完成后无旧 `MD`，再次打开为空写。
 *
 * 不处理范围：
 * 不读取原资产覆盖用户编辑，不猜测损坏行的归属。无法验证时拒绝准备，生命周期不提交打开期写入。
 */
export class MarkdownV2BlockMigration {
  /** 为全部历史 Markdown 文件生成一次原子替换。没有 V1 Item 时保持幂等空写。 */
  public build_writes(
    project_path: string,
    raw_items: readonly JsonValue[],
  ): ProjectDatabaseWrite[] {
    const replacements = this.build_replacements(raw_items);
    if (replacements.size === 0) {
      return [];
    }
    return [
      (database) => {
        const latest_items = this.read_database_items(database, project_path);
        const next_items = replace_project_file_items(latest_items, replacements);
        database.set_items(project_path, next_items);
        const meta = read_json_record(database.get_all_meta(project_path));
        database.upsert_meta_entries(project_path, {
          translation_extras: build_translation_extras_from_items({
            task_snapshot: read_json_record(meta["translation_extras"]),
            items: this.build_item_views(next_items),
          }) as JsonValue,
        });
        database.bump_section_revisions(project_path, ["files", "items"]);
      },
    ];
  }

  /** 把数据库未知返回值收窄为迁移可遍历的 Item 集合。 */
  private read_database_items(database: ProjectDatabase, project_path: string): JsonValue[] {
    const value = database.get_all_items(project_path);
    return Array.isArray(value) ? value : [];
  }

  /** 按文件收集并校验 V1 行，再构造不会携带旧类型的文件级 replacement。 */
  private build_replacements(raw_items: readonly JsonValue[]): Map<string, JsonValue[]> {
    const legacy_by_path = new Map<string, LegacyMarkdownItem[]>();
    for (const raw_item of raw_items) {
      const record = read_json_record(raw_item);
      if (record["file_type"] !== LEGACY_MARKDOWN_FILE_TYPE) {
        continue;
      }
      const item = this.read_legacy_item(record);
      const items = legacy_by_path.get(item.file_path) ?? [];
      items.push(item);
      legacy_by_path.set(item.file_path, items);
    }

    const replacements = new Map<string, JsonValue[]>();
    for (const [file_path, items] of legacy_by_path) {
      const sorted_items = [...items].sort(
        (left, right) => left.row - right.row || left.id - right.id,
      );
      this.validate_rows(file_path, sorted_items);
      this.resolve_duplicated_translations(sorted_items);
      replacements.set(file_path, this.build_file_replacement(sorted_items));
    }
    return replacements;
  }

  /** 严格读取迁移依赖的历史字段，损坏事实交由项目打开事务整体回滚。 */
  private read_legacy_item(record: JsonRecord): LegacyMarkdownItem {
    const file_path = typeof record["file_path"] === "string" ? record["file_path"] : "<unknown>";
    const id = Number(record["id"]);
    const row = Number(record["row"]);
    const status = record["status"];
    if (!Number.isInteger(id) || id <= 0) {
      this.fail(file_path, "item id is not a positive integer");
    }
    if (!Number.isInteger(row) || row < 0) {
      this.fail(file_path, "row is not a non-negative integer");
    }
    if (typeof record["src"] !== "string") {
      this.fail(file_path, "src is not readable text");
    }
    if (typeof record["dst"] !== "string") {
      this.fail(file_path, "dst is not readable text");
    }
    if (!is_item_status(status)) {
      this.fail(file_path, "status is outside the stable item value set");
    }
    if (file_path === "<unknown>" || file_path === "") {
      this.fail(file_path, "file_path is missing");
    }
    return {
      id,
      src: record["src"],
      dst: record["dst"],
      resolved_dst: record["dst"],
      row,
      file_path,
      status,
      skip_internal_filter: record["skip_internal_filter"] === true,
    };
  }

  /** V1 writer 以物理行顺序写回，因此只有从零连续的 row 才能无损重建。 */
  private validate_rows(file_path: string, items: LegacyMarkdownItem[]): void {
    for (const [index, item] of items.entries()) {
      if (item.row !== index) {
        this.fail(
          file_path,
          `rows must be unique and contiguous from zero; expected ${index.toString()}, received ${item.row.toString()}`,
        );
      }
    }
  }

  /** DUPLICATED 行复用同文件首个已处理同源译文，空译文继续回退原文。 */
  private resolve_duplicated_translations(items: LegacyMarkdownItem[]): void {
    const processed_by_src = new Map<string, string>();
    for (const item of items) {
      if (item.status === "PROCESSED" && !processed_by_src.has(item.src)) {
        processed_by_src.set(item.src, item.dst);
      }
    }
    for (const item of items) {
      if (item.status === "DUPLICATED") {
        item.resolved_dst = processed_by_src.get(item.src) ?? "";
      }
      if (item.resolved_dst === "") {
        item.resolved_dst = item.src;
      }
    }
  }

  /** 用同一 AST codec 重建源文和译文块，并迁移覆盖行上的用户事实。 */
  private build_file_replacement(items: LegacyMarkdownItem[]): JsonValue[] {
    const legacy_src = items.map((item) => item.src).join("\n");
    const legacy_dst = items.map((item) => item.resolved_dst).join("\n");
    const source_document = parse_markdown_v2_document(legacy_src);
    const destination_document = parse_markdown_v2_document(legacy_dst);
    const destination_index = this.build_destination_index(destination_document.units);
    return source_document.units.map((unit) => {
      const covered_items = items.slice(unit.start_line, unit.end_line + 1);
      const paired_destination = this.take_destination_unit(destination_index, unit);
      const paired_destination_text = paired_destination?.src ?? null;
      const fallback_destination = covered_items
        .map((item, index) =>
          index === 0 ? item.resolved_dst.slice(unit.start_column) : item.resolved_dst,
        )
        .join("\n");
      const has_translation = covered_items.some(
        (item) =>
          item.dst !== "" || (item.status === "DUPLICATED" && item.resolved_dst !== item.src),
      );
      const first_item = covered_items[0];
      return Item.from_json({
        ...(first_item === undefined ? {} : { id: first_item.id }),
        src: unit.src,
        dst: has_translation ? (paired_destination_text ?? fallback_destination) : "",
        row: unit.start_line,
        file_type: "MD_V2",
        file_path: items[0]!.file_path,
        text_type: "MD",
        status: this.aggregate_status(unit, covered_items),
        skip_internal_filter: covered_items.some((item) => item.skip_internal_filter),
        extra_field: {
          markdown: {
            before: unit.before,
            after: unit.after,
          },
        },
      }).to_json() as unknown as JsonValue;
    });
  }

  /** 译文块按起始行和 AST 类型建立有序桶，支持重复结构依次配对。 */
  private build_destination_index(units: MarkdownV2Unit[]): Map<string, MarkdownV2Unit[]> {
    const index = new Map<string, MarkdownV2Unit[]>();
    for (const unit of units) {
      const key = this.unit_key(unit);
      const bucket = index.get(key) ?? [];
      bucket.push(unit);
      index.set(key, bucket);
    }
    return index;
  }

  /** 每次只消费一个同位置译文块，避免重复结构复用同一译文。 */
  private take_destination_unit(
    index: Map<string, MarkdownV2Unit[]>,
    source_unit: MarkdownV2Unit,
  ): MarkdownV2Unit | null {
    return index.get(this.unit_key(source_unit))?.shift() ?? null;
  }

  /** 起始行与 AST 类型共同定义迁移期块配对身份。 */
  private unit_key(unit: MarkdownV2Unit): string {
    return `${unit.start_line.toString()}\u0000${unit.kind}`;
  }

  /** 按风险优先级聚合覆盖行状态，结构规则跳过始终优先。 */
  private aggregate_status(unit: MarkdownV2Unit, items: LegacyMarkdownItem[]): ItemStatus {
    if (unit.rule_skipped) {
      return "RULE_SKIPPED";
    }
    if (items.some((item) => item.status === "ERROR")) {
      return "ERROR";
    }
    if (items.some((item) => item.status === "NONE")) {
      return "NONE";
    }
    if (items.some((item) => item.status === "EXCLUDED" && item.dst === "")) {
      return "NONE";
    }
    const statuses = new Set(items.map((item) => item.status));
    if (statuses.size === 1 && statuses.has("RULE_SKIPPED")) {
      return "RULE_SKIPPED";
    }
    if (statuses.size === 1 && statuses.has("LANGUAGE_SKIPPED")) {
      return "LANGUAGE_SKIPPED";
    }
    return "PROCESSED";
  }

  /** 重建任务统计所需的最小 Item 视图，并为待分配 ID 的新块使用临时负值。 */
  private build_item_views(items: JsonValue[]): Map<number, ProjectItemViewRecord> {
    const result = new Map<number, ProjectItemViewRecord>();
    let generated_id = -1;
    for (const value of items) {
      const item = Item.from_json(value);
      const item_id = item.id ?? generated_id--;
      result.set(
        item_id,
        derive_project_item_view_record_from_public({ ...item.to_public_json(), item_id }),
      );
    }
    return result;
  }

  /** 迁移错误统一携带文件身份，便于项目打开失败时定位损坏来源。 */
  private fail(file_path: string, reason: string): never {
    throw new Error(`Cannot migrate Markdown file "${file_path}": ${reason}.`);
  }
}
