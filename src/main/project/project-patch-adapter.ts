import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  build_section_revisions_from_meta,
  get_runtime_section_revision,
  type RuntimeSection,
} from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";
import { is_task_skipped_item_status } from "../../shared/task";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

/**
 * 只适配 project.patch：普通 SSE frame 保持透传，运行态事实由 database 补全。
 */
export class ProjectPatchAdapter {
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly session_state: ProjectSessionState,
  ) {}

  /**
   * 兼容迁移窗口内的完整 patch，同时补全最小 patch 的 item / analysis / proofreading 块。
   */
  public adapt_project_patch(payload: JsonRecord): JsonRecord {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return payload;
    }
    const project_path = state.projectPath;
    const meta = this.get_all_meta(project_path);
    const updated_sections = this.normalize_updated_sections(payload["updatedSections"]);
    const patch = this.normalize_patch_operations(payload["patch"], project_path, meta);
    const section_revisions = this.build_section_revision_payload(meta, updated_sections);
    return {
      ...payload,
      updatedSections: updated_sections as unknown as ApiJsonValue,
      patch: patch as unknown as ApiJsonValue,
      sectionRevisions: section_revisions,
      projectRevision: Math.max(
        ...Object.values(build_section_revisions_from_meta(meta)),
        this.read_number(payload["projectRevision"], 0),
        0,
      ),
    };
  }

  private normalize_patch_operations(
    value: ApiJsonValue | undefined,
    project_path: string,
    meta: JsonRecord,
  ): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const operations: MutableJsonRecord[] = [];
    for (const raw_operation of value) {
      if (!this.is_record(raw_operation)) {
        continue;
      }
      const operation = { ...raw_operation };
      const op = String(operation["op"] ?? "");
      if (op === "merge_items" && !Array.isArray(operation["items"])) {
        const item_ids = this.normalize_number_list(operation["item_ids"] ?? operation["itemIds"]);
        operation["items"] = this.build_item_records(
          project_path,
          item_ids,
        ) as unknown as ApiJsonValue;
      } else if (op === "replace_analysis" && !this.is_record(operation["analysis"])) {
        operation["analysis"] = this.build_analysis_block(project_path) as unknown as ApiJsonValue;
      } else if (op === "replace_proofreading" && !this.is_record(operation["proofreading"])) {
        operation["proofreading"] = {
          revision: get_runtime_section_revision(meta, "proofreading"),
        };
      }
      operations.push(operation);
    }
    return operations;
  }

  private build_item_records(project_path: string, item_ids: number[]): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getItemsByIds", { projectPath: project_path, itemIds: item_ids }),
    );
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => this.normalize_item_record(item))
      : [];
  }

  private normalize_item_record(item: JsonRecord): MutableJsonRecord {
    return {
      item_id: this.read_number(item["id"], 0),
      file_path: String(item["file_path"] ?? ""),
      row_number: this.read_number(item["row"], 0),
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      name_src: item["name_src"] ?? null,
      name_dst: item["name_dst"] ?? null,
      status: String(item["status"] ?? "NONE"),
      text_type: String(item["text_type"] ?? "NONE"),
      retry_count: this.read_number(item["retry_count"], 0),
    };
  }

  private build_analysis_block(project_path: string): MutableJsonRecord {
    const meta = this.get_all_meta(project_path);
    return {
      extras: this.normalize_object(meta["analysis_extras"]),
      candidate_count: this.read_number(meta["analysis_candidate_count"], 0),
      candidate_aggregate: this.build_candidate_aggregate(project_path),
      status_summary: this.build_analysis_status_summary(project_path),
    };
  }

  private build_analysis_status_summary(project_path: string): MutableJsonRecord {
    const checkpoints = this.get_analysis_checkpoints(project_path);
    let total_line = 0;
    let processed_line = 0;
    let error_line = 0;
    for (const item of this.get_all_items(project_path)) {
      const status = String(item["status"] ?? "NONE");
      if (is_task_skipped_item_status(status)) {
        continue;
      }
      const item_id = this.read_number(item["id"], 0);
      if (item_id <= 0 || String(item["src"] ?? "").trim() === "") {
        continue;
      }
      total_line += 1;
      const checkpoint_status = checkpoints.get(item_id) ?? "NONE";
      if (checkpoint_status === "PROCESSED") {
        processed_line += 1;
      } else if (checkpoint_status === "ERROR") {
        error_line += 1;
      }
    }
    return {
      total_line,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  private build_candidate_aggregate(project_path: string): MutableJsonRecord {
    const value = this.database.execute(
      this.op("getAnalysisCandidateAggregates", { projectPath: project_path }),
    );
    if (!Array.isArray(value)) {
      return {};
    }
    const aggregate: MutableJsonRecord = {};
    for (const row of value) {
      if (!this.is_record(row)) {
        continue;
      }
      const src = String(row["src"] ?? "").trim();
      if (src !== "") {
        aggregate[src] = { ...row };
      }
    }
    return aggregate;
  }

  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  private get_analysis_checkpoints(project_path: string): Map<number, string> {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    const checkpoints = new Map<number, string>();
    if (!Array.isArray(value)) {
      return checkpoints;
    }
    for (const row of value) {
      if (!this.is_record(row)) {
        continue;
      }
      const item_id = this.read_number(row["item_id"], 0);
      const status = String(row["status"] ?? "");
      if (item_id > 0) {
        checkpoints.set(item_id, status);
      }
    }
    return checkpoints;
  }

  private build_section_revision_payload(
    meta: JsonRecord,
    updated_sections: RuntimeSection[],
  ): MutableJsonRecord {
    const section_revisions: MutableJsonRecord = {};
    for (const section of updated_sections) {
      section_revisions[section] = get_runtime_section_revision(meta, section);
    }
    return section_revisions;
  }

  private normalize_updated_sections(value: ApiJsonValue | undefined): RuntimeSection[] {
    const supported = new Set<RuntimeSection>([
      "project",
      "files",
      "items",
      "quality",
      "prompts",
      "analysis",
      "proofreading",
      "task",
    ]);
    if (!Array.isArray(value)) {
      return [];
    }
    const result: RuntimeSection[] = [];
    for (const section of value) {
      if (typeof section === "string" && supported.has(section as RuntimeSection)) {
        result.push(section as RuntimeSection);
      }
    }
    return [...new Set(result)];
  }

  private normalize_number_list(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .map((item) => this.read_number(item, NaN))
          .filter((item_id) => Number.isFinite(item_id) && item_id > 0),
      ),
    ];
  }

  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
