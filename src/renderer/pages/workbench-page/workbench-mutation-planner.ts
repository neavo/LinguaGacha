import type { ProjectStoreState } from "@/project/store/project-store";

type WorkbenchPlannerSettings = {
  source_language: string; // 后端预过滤使用的源语言设置
  mtool_optimizer_enable: boolean; // 后端 KVJSON 优化预过滤开关
  skip_duplicate_source_text_enable: boolean; // 后端同文件重复原文过滤开关
};

type WorkbenchPlannerFileRecord = {
  rel_path: string; // ProjectStore 中的项目内相对路径
  file_type: string; // 只用于前端路径校验，最终文件类型以后端解析为准
  sort_index: number; // 当前文件排序序号，重排命令用完整路径列表表达顺序
};

// 继承模式只表达用户意图，候选选择和最终译文继承由后端完成。
type WorkbenchTranslationInheritanceMode = "none" | "inherit";

export type WorkbenchProjectMutationPlan = {
  updatedSections: Array<"files" | "items" | "analysis">; // UI 预期受影响 section，真实 revision 以后端事件为准
  requestBody: Record<string, unknown>; // 只包含命令体，不包含 renderer 派生的最终 items/meta
};

type WorkbenchMutationPlanErrorCode =
  | "invalid_file_path"
  | "invalid_file_order"
  | "target_file_not_found"
  | "target_filename_conflict";

/**
 * WorkbenchMutationPlanError 只表达 planner 稳定失败原因，页面展示由调用处 fallback 决定。
 */
export class WorkbenchMutationPlanError extends Error {
  public readonly code: WorkbenchMutationPlanErrorCode; // code 是工作台 planner 唯一稳定错误分支

  /**
   * message 使用诊断标识而非自然语言，避免本地异常文本进入用户界面。
   */
  public constructor(code: WorkbenchMutationPlanErrorCode) {
    super(`workbench_mutation.${code}`);
    this.name = "WorkbenchMutationPlanError";
    this.code = code;
  }
}

// 创建稳定 planner 异常，避免调用点直接依赖 Error message。
function create_workbench_plan_error(
  code: WorkbenchMutationPlanErrorCode,
): WorkbenchMutationPlanError {
  return new WorkbenchMutationPlanError(code);
}

// 从 ProjectStore 文件镜像收窄出路径校验需要的字段。
function normalize_file_record(value: unknown): WorkbenchPlannerFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as WorkbenchPlannerFileRecord).rel_path ?? "").trim(),
    file_type: String((value as WorkbenchPlannerFileRecord).file_type ?? "NONE"),
    sort_index: Number((value as WorkbenchPlannerFileRecord).sort_index ?? 0),
  };
}

// 建立当前文件路径索引，planner 只做路径存在与冲突判断。
function build_file_map(state: ProjectStoreState): Map<string, WorkbenchPlannerFileRecord> {
  const file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const value of Object.values(state.files)) {
    const file = normalize_file_record(value);
    if (file === null || file.rel_path === "") {
      continue;
    }
    file_map.set(file.rel_path, file);
  }
  return file_map;
}

// 用户选择的目标路径去空去重，保证命令体路径集合稳定。
function normalize_target_rel_paths(rel_paths: string[]): string[] {
  const normalized_rel_paths: string[] = [];
  for (const rel_path of rel_paths) {
    const normalized_rel_path = String(rel_path).trim();
    if (normalized_rel_path === "" || normalized_rel_paths.includes(normalized_rel_path)) {
      continue;
    }
    normalized_rel_paths.push(normalized_rel_path);
  }
  if (normalized_rel_paths.length === 0) {
    throw create_workbench_plan_error("invalid_file_path");
  }
  return normalized_rel_paths;
}

// 每个 command 只携带它依赖的 section revision，由后端执行乐观锁。
function build_expected_revisions(
  state: ProjectStoreState,
  sections: Array<"files" | "items" | "analysis">,
): Record<string, number> {
  const expected_section_revisions: Record<string, number> = {};
  for (const section of sections) {
    expected_section_revisions[section] = state.revisions.sections[section] ?? 0;
  }
  return expected_section_revisions;
}

// 项目设置镜像只传后端重算预过滤需要的稳定字段。
function build_project_settings(settings: WorkbenchPlannerSettings): Record<string, unknown> {
  return {
    source_language: settings.source_language,
    mtool_optimizer_enable: settings.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
  };
}

// 工作台文件路径冲突按大小写不敏感口径预判，最终写入仍由后端校验。
function normalize_casefold_path(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

// 新增文件的目标路径不能和现有文件或同批文件重复。
function ensure_target_path_not_conflict(args: {
  file_map: Map<string, WorkbenchPlannerFileRecord>;
  target_rel_path: string;
  batch_target_path_set: Set<string>;
}): void {
  const target_key = normalize_casefold_path(args.target_rel_path);
  if (args.batch_target_path_set.has(target_key)) {
    throw create_workbench_plan_error("target_filename_conflict");
  }
  for (const existing_rel_path of args.file_map.keys()) {
    if (normalize_casefold_path(existing_rel_path) === target_key) {
      throw create_workbench_plan_error("target_filename_conflict");
    }
  }
  args.batch_target_path_set.add(target_key);
}

// 重排命令必须完整覆盖当前文件集合，不能提交局部排序片段。
export function create_workbench_reorder_plan(args: {
  state: ProjectStoreState;
  ordered_rel_paths: string[];
}): WorkbenchProjectMutationPlan {
  const file_map = build_file_map(args.state);
  const ordered_rel_paths = normalize_target_rel_paths(args.ordered_rel_paths);
  if (ordered_rel_paths.length !== file_map.size) {
    throw create_workbench_plan_error("invalid_file_order");
  }

  for (const rel_path of ordered_rel_paths) {
    if (!file_map.has(rel_path)) {
      throw create_workbench_plan_error("invalid_file_order");
    }
  }

  return {
    updatedSections: ["files"],
    requestBody: {
      ordered_rel_paths,
      expected_section_revisions: build_expected_revisions(args.state, ["files"]),
    },
  };
}

// 重置文件只提交目标路径和设置镜像，items 与派生 meta 由后端重算。
export function create_workbench_reset_file_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  rel_path: string;
  settings: WorkbenchPlannerSettings;
}): WorkbenchProjectMutationPlan {
  const file_map = build_file_map(args.state);
  const target_rel_path = String(args.rel_path).trim();
  if (target_rel_path === "") {
    throw create_workbench_plan_error("invalid_file_path");
  }
  if (!file_map.has(target_rel_path)) {
    throw create_workbench_plan_error("target_file_not_found");
  }

  return {
    updatedSections: ["items", "analysis"],
    requestBody: {
      rel_paths: [target_rel_path],
      project_settings: build_project_settings(args.settings),
      expected_section_revisions: build_expected_revisions(args.state, ["items", "analysis"]),
    },
  };
}

// 删除文件只提交目标路径集合，文件删除、items 过滤和分析重置由后端事务完成。
export function create_workbench_delete_files_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  rel_paths: string[];
  settings: WorkbenchPlannerSettings;
}): WorkbenchProjectMutationPlan {
  const target_rel_paths = normalize_target_rel_paths(args.rel_paths);
  const file_map = build_file_map(args.state);
  if (!target_rel_paths.some((rel_path) => file_map.has(rel_path))) {
    throw create_workbench_plan_error("target_file_not_found");
  }

  return {
    updatedSections: ["files", "items", "analysis"],
    requestBody: {
      rel_paths: target_rel_paths,
      project_settings: build_project_settings(args.settings),
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
  };
}

export type WorkbenchFileParsePreview = {
  source_path: string; // 用户选择的源文件路径，提交时作为 add-file 命令输入
  target_rel_path: string; // UI 预览得到的项目内目标路径
  file_type: string; // UI 预览展示字段，提交时不把它作为最终事实
  parsed_items: Array<Record<string, unknown>>; // UI 预览展示字段，提交时不提交解析后的 item
};

// 新增文件提交源路径、目标路径和继承模式；id 分配、解析、继承和预过滤都在后端。
export function create_workbench_add_files_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  parsed_files: WorkbenchFileParsePreview[];
  settings: WorkbenchPlannerSettings;
  inheritance_mode?: WorkbenchTranslationInheritanceMode;
}): WorkbenchProjectMutationPlan {
  if (args.parsed_files.length === 0) {
    throw create_workbench_plan_error("invalid_file_path");
  }

  const file_map = build_file_map(args.state);
  const batch_target_path_set = new Set<string>();
  const files = args.parsed_files.map((parsed_file) => {
    const target_rel_path = parsed_file.target_rel_path.trim();
    if (target_rel_path === "") {
      throw create_workbench_plan_error("invalid_file_path");
    }
    ensure_target_path_not_conflict({
      file_map,
      target_rel_path,
      batch_target_path_set,
    });
    return {
      source_path: parsed_file.source_path,
      target_rel_path,
    };
  });

  return {
    updatedSections: ["files", "items", "analysis"],
    requestBody: {
      files,
      inheritance_mode: args.inheritance_mode ?? "none",
      project_settings: build_project_settings(args.settings),
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
  };
}
