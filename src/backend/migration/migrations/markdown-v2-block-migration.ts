import { Item, is_item_status, type ItemStatus } from "../../../domain/item";
import { read_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import {
  parse_markdown_v2_document,
  restore_markdown_v2_resources,
  type MarkdownV2Unit,
} from "../../file/formats/markdown/md-v2-document";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../../database/database-operations";
import {
  build_translation_extras_from_items,
  type ProjectItemViewRecord,
} from "../../project/project-write-state";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";
import { replace_project_file_items } from "../project-open-file-item-replacement";

const LEGACY_MARKDOWN_FILE_TYPE = "MD";

type LegacyMarkdownItem = {
  id: number;
  src: string;
  dst: string;
  resolved_dst: string;
  row: number;
  file_path: string;
  status: ItemStatus;
  retry_count: number;
  skip_internal_filter: boolean;
};

export const markdown_v2_block_migration: MigrationDescriptor = {
  id: "markdown-v2-block",
  order: 900,
  /** 在 project-open 阶段准备文件级替换，让提交仍由生命周期事务统一执行。 */
  build_project_open_writes(context: ProjectOpenMigrationContext): ProjectDatabaseWrite[] {
    return new MarkdownV2BlockMigration(context.database).build_writes(context.project_path);
  },
};

/**
 * 把历史逐行 Markdown Item 一次性重建为当前 AST 块契约。
 */
export class MarkdownV2BlockMigration {
  /** 固定项目数据库快照入口，生成的 write 会在提交时重新读取事务内当前事实。 */
  public constructor(private readonly database: ProjectDatabase) {}

  /** 为全部历史 Markdown 文件生成一次原子替换；没有 V1 Item 时保持幂等空写。 */
  public build_writes(project_path: string): ProjectDatabaseWrite[] {
    const raw_items = this.read_database_items(this.database, project_path);
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
        database.delete_analysis_item_checkpoints(project_path);
        database.clear_analysis_candidate_aggregates(project_path);
        database.upsert_meta_entries(project_path, {
          translation_extras: build_translation_extras_from_items({
            task_snapshot: read_json_record(meta["translation_extras"]),
            items: this.build_item_views(next_items),
          }) as JsonValue,
          analysis_extras: {},
          analysis_candidate_count: 0,
        });
        database.bump_section_revisions(project_path, ["files", "items", "analysis"]);
      },
    ];
  }

  /** 把数据库未知返回值收窄为迁移可遍历的 Item 集合。 */
  private read_database_items(database: ProjectDatabase, project_path: string): JsonValue[] {
    const value = database.get_all_items(project_path);
    return Array.isArray(value) ? value : [];
  }

  /** 按文件收集并校验 V1 行，再构造不会携带旧类型的文件级 replacement。 */
  private build_replacements(raw_items: JsonValue[]): Map<string, JsonValue[]> {
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
      retry_count: this.read_non_negative_integer(record["retry_count"]),
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
    const destination_resource_replacements = this.build_destination_resource_replacements(
      source_document.resources,
      destination_document.resources,
    );

    return source_document.units.map((unit) => {
      const covered_items = items.filter(
        (item) => item.row >= unit.start_line && item.row <= unit.end_line,
      );
      const paired_destination = this.take_destination_unit(destination_index, unit);
      const paired_destination_text =
        paired_destination === null
          ? null
          : restore_markdown_v2_resources(
              paired_destination.src,
              destination_resource_replacements,
            );
      const fallback_destination = this.project_resource_tokens(
        covered_items
          .map((item, index) =>
            index === 0 ? item.resolved_dst.slice(unit.start_column) : item.resolved_dst,
          )
          .join("\n"),
        unit,
        source_document.resources,
      );
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
        retry_count: Math.max(0, ...covered_items.map((item) => item.retry_count)),
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

  /** 同 URL 的译文资源复用源 token，译文独有 URL 恢复为用户当前值。 */
  private build_destination_resource_replacements(
    source_resources: ReadonlyMap<string, string>,
    destination_resources: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> {
    const source_tokens_by_url = new Map<string, string[]>();
    for (const [token, url] of source_resources) {
      const tokens = source_tokens_by_url.get(url) ?? [];
      tokens.push(token);
      source_tokens_by_url.set(url, tokens);
    }
    return new Map(
      [...destination_resources].map(([token, url]) => [
        token,
        source_tokens_by_url.get(url)?.shift() ?? url,
      ]),
    );
  }

  /** fallback 译文走同一 URL 对齐，只使用当前源块实际拥有的资源 token。 */
  private project_resource_tokens(
    text: string,
    source_unit: MarkdownV2Unit,
    source_resources: ReadonlyMap<string, string>,
  ): string {
    const destination_document = parse_markdown_v2_document(text);
    const source_tokens = new Set(parse_markdown_v2_document(source_unit.src).resources.values());
    const unit_source_resources = new Map(
      [...source_resources].filter(([token]) => source_tokens.has(token)),
    );
    const replacements = this.build_destination_resource_replacements(
      unit_source_resources,
      destination_document.resources,
    );
    return destination_document.units
      .map(
        (unit) => unit.before + restore_markdown_v2_resources(unit.src, replacements) + unit.after,
      )
      .join("");
  }

  /** 按风险优先级聚合覆盖行状态，结构性排除始终优先。 */
  private aggregate_status(unit: MarkdownV2Unit, items: LegacyMarkdownItem[]): ItemStatus {
    if (unit.excluded) {
      return "EXCLUDED";
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
      result.set(item_id, {
        item_id,
        file_path: item.file_path,
        row_number: item.row,
        src: item.src,
        dst: item.dst,
        name_dst: item.name_dst,
        status: item.status,
        text_type: item.text_type,
        retry_count: item.retry_count,
        skip_internal_filter: item.skip_internal_filter,
      });
    }
    return result;
  }

  /** 历史计数统一收窄为非负整数，非法可选值按零处理。 */
  private read_non_negative_integer(value: JsonValue | undefined): number {
    const number_value = Number(value ?? 0);
    return Number.isFinite(number_value) ? Math.max(0, Math.trunc(number_value)) : 0;
  }

  /** 迁移错误统一携带文件身份，便于项目打开失败时定位损坏来源。 */
  private fail(file_path: string, reason: string): never {
    throw new Error(`Cannot migrate Markdown file "${file_path}": ${reason}.`);
  }
}
