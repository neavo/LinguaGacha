import type { ProjectFileRecord } from "./project-file-records";
import { build_project_translation_stats } from "../../shared/project-translation-stats";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type {
  WorkbenchFileEntry,
  WorkbenchQueryResponse,
} from "../../shared/workbench/workbench-query";
import type { ProjectTranslationStatsResponse } from "../../shared/project-translation-stats";
import type { CacheReadPort } from "../cache/cache-types";

import type { ProjectSessionState } from "./project-session-state";

/**
 * 基于已提交的工程快照，生成工作台与跨页面的条目统计。
 */
export class ProjectSummaryService {
  /**
   * session_state 提供工程身份，cache 提供当前项目热读事实。
   */
  public constructor(
    private readonly session_state: ProjectSessionState,
    private readonly cache: CacheReadPort,
  ) {}

  /**
   * 工作台快照承接文件列表，跨页面翻译统计由独立查询提供。
   */
  public read(): WorkbenchQueryResponse {
    const project_path = this.session_state.require_loaded_project_path();
    const items = this.cache.items.readItems();
    const cached_file_entries = this.cache.files.readFileEntries();
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions(),
      snapshot: {
        entries: this.build_file_entries(items, cached_file_entries),
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
    cached_file_entries: ProjectFileRecord[],
  ): WorkbenchFileEntry[] {
    const entries_by_path = new Map<string, ProjectItemPublicRecord[]>();
    for (const item of items) {
      const file_path = item.file_path;
      if (file_path === "") {
        continue;
      }
      const bucket = entries_by_path.get(file_path);
      if (bucket) bucket.push(item);
      else entries_by_path.set(file_path, [item]);
    }
    return cached_file_entries.map(({ rel_path, file_type, sort_index }) => ({
      rel_path,
      file_type,
      sort_index,
      progress: build_project_translation_stats(entries_by_path.get(rel_path) ?? []),
    }));
  }
}
