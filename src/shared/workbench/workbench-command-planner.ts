export type WorkbenchPlannerSettings = {
  source_language: string; // 后端预过滤使用的源语言设置
  mtool_optimizer_enable: boolean; // 后端 KVJSON 优化预过滤开关
  skip_duplicate_source_text_enable: boolean; // 后端同文件重复原文过滤开关
};

type WorkbenchPlannerFileRecord = {
  rel_path: string; // 后端 query 返回的项目内相对路径
  file_type: string; // 只用于前端路径校验，最终文件类型以后端解析为准
  sort_index: number; // 当前文件排序序号，重排命令用完整路径列表表达顺序
};

// 继承模式只表达用户意图，候选选择和最终译文继承由后端完成。
type WorkbenchTranslationInheritanceMode = "none" | "inherit";

export type WorkbenchFileConflictAction = "skip" | "replace";

export type WorkbenchCommandPlanningState = {
  files: WorkbenchPlannerFileRecord[]; // 来自后端工作台 query 的当前文件窗口事实
  section_revisions: Record<string, number>; // 写入乐观锁只读取本次 query 携带的 revision
};

export type WorkbenchCommandPlan = {
  updatedSections: Array<"files" | "items" | "analysis">; // UI 预期受影响 section，真实 revision 以后端事件为准
  requestBody: Record<string, unknown>; // 只包含命令体，不包含渲染进程计算的最终 items/meta
};

type WorkbenchCommandPlanErrorCode =
  | "invalid_file_path"
  | "invalid_file_order"
  | "target_file_not_found";

/**
 * WorkbenchCommandPlanError 只表达 planner 稳定失败原因，页面展示由调用处 fallback 决定。
 */
export class WorkbenchCommandPlanError extends Error {
  public readonly code: WorkbenchCommandPlanErrorCode; // code 是工作台 planner 唯一稳定错误分支

  /**
   * message 使用诊断标识而非自然语言，避免本地异常文本进入用户界面。
   */
  public constructor(code: WorkbenchCommandPlanErrorCode) {
    super(`workbench_command.${code}`);
    this.name = "WorkbenchCommandPlanError";
    this.code = code;
  }
}

// 创建稳定 planner 异常，避免调用点直接依赖 Error message。
function create_workbench_plan_error(
  code: WorkbenchCommandPlanErrorCode,
): WorkbenchCommandPlanError {
  return new WorkbenchCommandPlanError(code);
}

// 从工作台 query 文件视图收窄出路径校验需要的字段。
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
function build_file_map(
  state: WorkbenchCommandPlanningState,
): Map<string, WorkbenchPlannerFileRecord> {
  const file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const value of state.files) {
    const file = normalize_file_record(value);
    if (file === null || file.rel_path === "") {
      continue;
    }
    file_map.set(file.rel_path, file);
  }
  return file_map;
}

function build_casefold_file_map(
  state: WorkbenchCommandPlanningState,
): Map<string, WorkbenchPlannerFileRecord> {
  // 同名判断采用工作台文件口径的大小写不敏感 key，保留原始 rel_path 作为提交规范路径。
  const file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const file of build_file_map(state).values()) {
    file_map.set(normalize_casefold_path(file.rel_path), file);
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
  state: WorkbenchCommandPlanningState,
  sections: Array<"files" | "items" | "analysis">,
): Record<string, number> {
  const expected_section_revisions: Record<string, number> = {};
  for (const section of sections) {
    expected_section_revisions[section] = state.section_revisions[section] ?? 0;
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

// 从完整运行态设置提取出工作台 planner 可消费的命令设置。
export function create_workbench_planner_settings(
  settings: WorkbenchPlannerSettings,
): WorkbenchPlannerSettings {
  // 工作台写入边界只保留预过滤设置，避免完整应用设置泄漏进命令规划。
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

// 重排命令必须完整覆盖当前文件集合，不能提交局部排序片段。
export function create_workbench_reorder_plan(args: {
  state: WorkbenchCommandPlanningState;
  ordered_rel_paths: string[];
}): WorkbenchCommandPlan {
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

// 重置文件只提交目标路径和设置镜像，items 与计算元数据由后端重算。
export function create_workbench_reset_file_plan(args: {
  state: WorkbenchCommandPlanningState;
  task_snapshot?: Record<string, unknown>;
  rel_path: string;
  settings: WorkbenchPlannerSettings;
}): WorkbenchCommandPlan {
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
  state: WorkbenchCommandPlanningState;
  task_snapshot?: Record<string, unknown>;
  rel_paths: string[];
  settings: WorkbenchPlannerSettings;
}): WorkbenchCommandPlan {
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
  source_path: string; // 用户选择的源文件路径，提交时作为 import-files 命令输入
  target_rel_path: string; // UI 预览得到的项目内目标路径
  file_type: string; // UI 预览展示字段，提交时不把它作为最终事实
  parsed_items: Array<Record<string, unknown>>; // UI 预览展示字段，提交时不提交解析后的 item
};

export type WorkbenchImportFilesPreview = {
  importable_files: WorkbenchFileParsePreview[];
  new_files: WorkbenchFileParsePreview[];
  conflicting_files: WorkbenchFileParsePreview[];
  conflict_signature: string;
};

function normalize_import_file(parsed_file: WorkbenchFileParsePreview): WorkbenchFileParsePreview {
  // 预演阶段只修剪路径字段，parsed_items 仍然只是 UI 预览数据。
  return {
    ...parsed_file,
    source_path: parsed_file.source_path.trim(),
    target_rel_path: parsed_file.target_rel_path.trim(),
  };
}

function is_import_file_usable(parsed_file: WorkbenchFileParsePreview): boolean {
  // 空源路径或空目标路径无法表达用户导入意图，直接排除在计划外。
  return parsed_file.source_path.trim() !== "" && parsed_file.target_rel_path.trim() !== "";
}

function collect_batch_duplicate_target_keys(
  parsed_files: WorkbenchFileParsePreview[],
): Set<string> {
  // 同一批内部重名没有可靠的用户意图顺序，必须整体排除，避免隐式覆盖。
  const count_by_key = new Map<string, number>();
  for (const parsed_file of parsed_files) {
    const target_key = normalize_casefold_path(parsed_file.target_rel_path);
    if (target_key === "") {
      continue;
    }
    count_by_key.set(target_key, (count_by_key.get(target_key) ?? 0) + 1);
  }
  return new Set(
    [...count_by_key.entries()].flatMap(([target_key, count]) => {
      return count > 1 ? [target_key] : [];
    }),
  );
}

function build_import_conflict_signature(files: WorkbenchFileParsePreview[]): string {
  // 对话确认期间用签名捕捉当前同名集合，提交前变更则重新让用户选择策略。
  return files
    .map((file, index) => {
      return [index, normalize_casefold_path(file.target_rel_path), file.target_rel_path].join(":");
    })
    .join("|");
}

// 工作台导入预演只判断新增与同名替换候选，不把解析出的 item 当作最终事实。
export function create_workbench_import_files_preview(args: {
  state: WorkbenchCommandPlanningState;
  parsed_files: WorkbenchFileParsePreview[];
}): WorkbenchImportFilesPreview {
  const existing_file_map = build_casefold_file_map(args.state);
  const batch_duplicate_target_keys = collect_batch_duplicate_target_keys(args.parsed_files);
  const importable_files: WorkbenchFileParsePreview[] = [];
  const new_files: WorkbenchFileParsePreview[] = [];
  const conflicting_files: WorkbenchFileParsePreview[] = [];

  for (const raw_file of args.parsed_files) {
    if (!is_import_file_usable(raw_file)) {
      continue;
    }
    const parsed_file = normalize_import_file(raw_file);
    const target_key = normalize_casefold_path(parsed_file.target_rel_path);
    if (batch_duplicate_target_keys.has(target_key)) {
      continue;
    }
    const existing_file = existing_file_map.get(target_key);
    const import_file =
      existing_file === undefined
        ? parsed_file
        : {
            ...parsed_file,
            target_rel_path: existing_file.rel_path,
          };
    importable_files.push(import_file);
    if (existing_file === undefined) {
      new_files.push(import_file);
    } else {
      conflicting_files.push(import_file);
    }
  }

  return {
    importable_files,
    new_files,
    conflicting_files,
    conflict_signature: build_import_conflict_signature(conflicting_files),
  };
}

function select_import_files(
  preview: WorkbenchImportFilesPreview,
  conflict_action: WorkbenchFileConflictAction,
): WorkbenchFileParsePreview[] {
  // 跳过只提交新文件；替换提交新文件和同名候选，具体写入仍以后端事务为准。
  return conflict_action === "replace" ? preview.importable_files : preview.new_files;
}

// 文件导入提交源路径、目标路径、同名策略和继承模式；id 分配、解析、继承和预过滤都在后端。
export function create_workbench_import_files_plan(args: {
  state: WorkbenchCommandPlanningState;
  task_snapshot?: Record<string, unknown>;
  parsed_files: WorkbenchFileParsePreview[];
  conflict_action: WorkbenchFileConflictAction;
  settings: WorkbenchPlannerSettings;
  inheritance_mode?: WorkbenchTranslationInheritanceMode;
}): WorkbenchCommandPlan {
  const preview = create_workbench_import_files_preview({
    state: args.state,
    parsed_files: args.parsed_files,
  });
  const files_to_import = select_import_files(preview, args.conflict_action);
  if (files_to_import.length === 0) {
    throw create_workbench_plan_error("invalid_file_path");
  }

  const files = files_to_import.map((parsed_file) => {
    return {
      source_path: parsed_file.source_path,
      target_rel_path: parsed_file.target_rel_path,
    };
  });

  return {
    updatedSections: ["files", "items", "analysis"],
    requestBody: {
      files,
      conflict_action: args.conflict_action,
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
