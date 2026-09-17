import { build_project_file_paths } from "../../shared/project/project-file-paths";
import {
  build_project_translation_stats,
  calculate_completion_percent,
} from "../../shared/project-translation-stats";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { PDFSummary } from "../../shared/pdf";
import type {
  WorkbenchFileEntry,
  WorkbenchFileProgress,
  WorkbenchQueryResponse,
} from "../../shared/workbench/workbench-query";
import type { ProjectTranslationStatsResponse } from "../../shared/project-translation-stats";
import type { CacheFileEntry, CacheReadPort } from "../cache/cache-types";

import type { ProjectSessionState } from "./project-session-state";

/**
 * 后端查询服务从 cache 门面读取热数据，并返回页面级快照。
 */
export class ProjectSummaryService {
  /**
   * session_state 提供工程身份，cache 提供当前项目热读事实。
   */
  public constructor(
    private readonly session_state: ProjectSessionState,
    private readonly cache: CacheReadPort,
    private readonly database: Pick<ProjectDatabase, "read_pdf_summaries">,
  ) {}

  /**
   * 工作台快照承接文件列表，跨页面翻译统计由独立查询提供。
   */
  public read(): WorkbenchQueryResponse {
    const project_path = this.session_state.require_loaded_project_path();
    const items = this.cache.items.readItems();
    const cached_file_entries = this.cache.files.readFileEntries();
    const pdf = cached_file_entries.some((entry) => entry.file_type === "PDF")
      ? this.database.read_pdf_summaries(project_path)
      : {};
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions(),
      snapshot: {
        entries: this.build_file_entries(items, cached_file_entries, pdf),
      },
    };
  }

  /** 工程身份随统计返回，供共享缓存隔离切换期间的响应。 */
  public read_translation_stats(): ProjectTranslationStatsResponse {
    const projectPath = this.session_state.require_loaded_project_path();
    return {
      projectPath,
      stats: build_project_translation_stats(this.cache.items.readItems()),
    };
  }

  /**
   * 按文件路径聚合列表与进度，顺序由 FileCache 拥有。
   */
  private build_file_entries(
    items: ProjectItemPublicRecord[],
    cached_file_entries: CacheFileEntry[],
    pdf_summaries: Record<string, PDFSummary>,
  ): WorkbenchFileEntry[] {
    const entries_by_path = new Map<string, ProjectItemPublicRecord[]>();
    for (const item of items) {
      const file_path = item.file_path;
      if (file_path === "") {
        continue;
      }
      const bucket = entries_by_path.get(file_path) ?? [];
      bucket.push(item);
      entries_by_path.set(file_path, bucket);
    }
    // files section 在存在 asset 时只包含 asset；摘要还需补齐历史条目独有的路径。
    const files_by_path = new Map(cached_file_entries.map((entry) => [entry.rel_path, entry]));
    return build_project_file_paths([...files_by_path.keys()], [...entries_by_path.keys()]).map(
      (rel_path, index) => {
        const file_items = entries_by_path.get(rel_path) ?? [];
        const file_entry = files_by_path.get(rel_path) ?? {
          rel_path,
          file_type: file_items[0]?.file_type ?? "NONE",
          sort_index: index,
        };
        return this.build_project_file_entry(file_entry, file_items, pdf_summaries);
      },
    );
  }

  /**
   * PDF 摘要按原页计数，核对标记独立于翻译完成率。
   */
  private build_project_file_entry(
    file_entry: CacheFileEntry,
    file_items: ProjectItemPublicRecord[],
    pdf_summaries: Record<string, PDFSummary>,
  ): WorkbenchFileEntry {
    let progress: WorkbenchFileProgress;
    if (file_entry.file_type === "PDF") {
      const pdf = pdf_summaries[file_entry.rel_path];
      const skipped_count = pdf.kept_pages + pdf.omitted_pages; // 两种处置均完成处理，导出时仍区分保留与省略。
      progress = {
        unit: "page",
        total_count: pdf.pages,
        completed_count: pdf.translated_pages,
        skipped_count,
        failed_count: null,
        pending_count: pdf.pages - pdf.translated_pages - skipped_count,
        completion_percent: calculate_completion_percent(
          pdf.pages,
          pdf.translated_pages,
          skipped_count,
        ),
      };
    } else {
      const { total_items, ...stats } = build_project_translation_stats(file_items);
      progress = { unit: "line", total_count: total_items, ...stats };
    }
    return {
      rel_path: file_entry.rel_path,
      file_type: file_entry.file_type,
      sort_index: file_entry.sort_index,
      progress,
    };
  }
}
