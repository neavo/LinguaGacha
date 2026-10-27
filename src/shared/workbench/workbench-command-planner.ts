import type { SourceFileParseFailureRecord } from "../source-file-parse-failure";

type WorkbenchCommandSection = "files" | "items" | "pdf";
type WorkbenchSectionRevisions = Record<string, number | undefined>;

type WorkbenchPlannerFileRecord = {
  file_type?: string; // PDF 内容重置需要其独立 revision
  rel_path: string; // 后端 query 返回的项目内相对路径
};

// 继承模式只表达用户意图，候选选择和最终译文继承由后端完成。
type WorkbenchTranslationInheritanceMode = "none" | "inherit";

export type WorkbenchFileConflictAction = "skip" | "replace";

export type WorkbenchCommandPlanningState = {
  files: WorkbenchPlannerFileRecord[]; // 来自后端工作台 query 的当前文件窗口事实
  section_revisions: WorkbenchSectionRevisions; // 写入乐观锁只读取本次 query 携带的 revision
};

export type WorkbenchCommandPlan = {
  updatedSections: WorkbenchCommandSection[]; // UI 预期受影响 section，真实 revision 以后端事件为准
  requestBody: Record<string, unknown>; // 只包含命令体，不包含渲染进程计算的最终 items/meta
};

// 建立当前文件路径索引，planner 只做路径存在与冲突判断。
function build_file_map(
  state: WorkbenchCommandPlanningState,
): Map<string, WorkbenchPlannerFileRecord> {
  const file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const file of state.files) {
    if (file.rel_path === "") {
      continue;
    }
    file_map.set(file.rel_path, file);
  }
  return file_map;
}

// 用户选择的目标路径去空去重，保证命令体路径集合稳定。
function normalize_target_rel_paths(rel_paths: string[]): string[] {
  const normalized_rel_paths = [...new Set(rel_paths.filter((rel_path) => rel_path.trim() !== ""))];
  if (normalized_rel_paths.length === 0) {
    throw new Error("At least one target file path is required.");
  }
  return normalized_rel_paths;
}

// 每个 command 只携带它依赖的 section revision，由后端执行乐观锁。
function build_expected_revisions(
  state: WorkbenchCommandPlanningState,
  sections: WorkbenchCommandSection[],
): Record<string, number> {
  const expected_section_revisions: Record<string, number> = {};
  for (const section of sections) {
    expected_section_revisions[section] = state.section_revisions[section] ?? 0;
  }
  return expected_section_revisions;
}

// 重排命令必须完整覆盖当前文件集合，不能提交局部排序片段。
export function create_workbench_reorder_plan(args: {
  state: WorkbenchCommandPlanningState;
  ordered_rel_paths: string[];
}): WorkbenchCommandPlan {
  const file_map = build_file_map(args.state);
  const ordered_rel_paths = normalize_target_rel_paths(args.ordered_rel_paths);
  if (
    ordered_rel_paths.length !== file_map.size ||
    ordered_rel_paths.some((rel_path) => !file_map.has(rel_path))
  ) {
    throw new Error("File order must contain every current workbench file exactly once.");
  }

  return {
    updatedSections: ["files"],
    requestBody: {
      ordered_rel_paths,
      expected_section_revisions: build_expected_revisions(args.state, ["files"]),
    },
  };
}

// 重置文件只提交目标路径，items 与计算元数据由后端按项目设置重算。
export function create_workbench_reset_file_plan(args: {
  state: WorkbenchCommandPlanningState;
  rel_path: string;
}): WorkbenchCommandPlan {
  const file_map = build_file_map(args.state);
  const target_rel_path = args.rel_path;
  if (target_rel_path.trim() === "") {
    throw new Error("A target file path is required.");
  }
  if (!file_map.has(target_rel_path)) {
    throw new Error("Target file was not found in the current workbench.");
  }

  const sections: WorkbenchCommandSection[] =
    file_map.get(target_rel_path)?.file_type === "PDF" ? ["items", "pdf"] : ["items"];
  return {
    updatedSections: sections,
    requestBody: {
      rel_paths: [target_rel_path],
      expected_section_revisions: build_expected_revisions(args.state, ["files", ...sections]),
    },
  };
}

// 删除文件只提交目标路径集合，文件删除、items 过滤和翻译进度更新由后端事务完成。
export function create_workbench_delete_files_plan(args: {
  state: WorkbenchCommandPlanningState;
  rel_paths: string[];
}): WorkbenchCommandPlan {
  const target_rel_paths = normalize_target_rel_paths(args.rel_paths);
  const file_map = build_file_map(args.state);
  if (!target_rel_paths.some((rel_path) => file_map.has(rel_path))) {
    throw new Error("No target file exists in the current workbench.");
  }

  return {
    updatedSections: ["files", "items"],
    requestBody: {
      rel_paths: target_rel_paths,
      expected_section_revisions: build_expected_revisions(args.state, ["files", "items"]),
    },
  };
}

export type WorkbenchImportFileCandidate = {
  source_path: string;
  target_rel_path: string; // 后端预览分配的规范资产路径。
  conflict: boolean;
};

export type WorkbenchImportFilesPreview = {
  godot_packs?: readonly import("../godot").GodotPackPreview[];
  files_revision: number; // 与命名和冲突分类来自同一次数据库读取。
  files: WorkbenchImportFileCandidate[];
  contains_game: boolean; // 原生游戏会改写游戏目录，界面据此提示完整备份。
  failed_files?: SourceFileParseFailureRecord[];
};

// 前端只提交预览候选和用户选择，名称与冲突分类由后端拥有。
export function create_workbench_import_files_plan(args: {
  state: WorkbenchCommandPlanningState;
  preview: WorkbenchImportFilesPreview;
  conflict_action: WorkbenchFileConflictAction;
  inheritance_mode?: WorkbenchTranslationInheritanceMode;
}): WorkbenchCommandPlan {
  const files = args.preview.files
    .filter((file) => args.conflict_action === "replace" || !file.conflict)
    .map(({ source_path, target_rel_path }) => ({ source_path, target_rel_path }));
  if (files.length === 0) throw new Error("No importable workbench files were selected.");
  return {
    updatedSections: ["files", "items"],
    requestBody: {
      files,
      conflict_action: args.conflict_action,
      inheritance_mode: args.inheritance_mode ?? "none",
      expected_section_revisions: {
        files: args.preview.files_revision,
        items: args.state.section_revisions.items ?? 0,
      },
    },
  };
}
