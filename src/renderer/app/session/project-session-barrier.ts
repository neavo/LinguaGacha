import type {
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "@/project/store/project-store";

// ProjectSessionBarrierKind 是页面和运行态之间公开等待点的唯一词表。
export type ProjectSessionBarrierKind =
  | "project_session_ready"
  | "workbench_file_operation"
  | "workbench_cache_refresh"
  | "proofreading_cache_refresh";

// ProjectSessionPageCacheKind 只描述已接入 session barrier 的页面缓存种类。
export type ProjectSessionPageCacheKind = "workbench" | "proofreading";

// ProjectSessionPageCacheSnapshot 是页面挂载期间提交给全局 session 的缓存状态快照。
export type ProjectSessionPageCacheSnapshot = {
  isRefreshing: boolean; // 页面缓存是否正在追赶 ProjectStore 当前事实
  consumedRevisions: ProjectDataSectionRevisions; // 页面缓存已经消费到的 section revision
  requiredSections: ProjectDataSection[]; // 页面缓存声明依赖的 ProjectStore section
  settledProjectPath: string; // 页面缓存当前稳定对应的项目路径
  fileOperationRunning?: boolean; // 只有工作台文件操作需要额外阻塞文件类 barrier
};

// ProjectSessionBarrierCheckpoint 是操作开始时的项目身份锚点，异步等待期间不随当前路由漂移。
export type ProjectSessionBarrierCheckpoint = {
  projectPath: string; // checkpoint 只锚定目标项目，不保存未挂载页面的历史缓存
};

// ProjectSessionBarrierOptions 是页面动作等待 barrier 时传入的目标解析参数。
export type ProjectSessionBarrierOptions = {
  projectPath?: string; // projectPath 允许调用方显式绑定等待的目标项目
  checkpoint?: ProjectSessionBarrierCheckpoint | null; // checkpoint 固定操作开始时的项目身份
};

// ProjectSessionBarrierState 是全局 session 与当前已挂载页面缓存的只读判定输入。
export type ProjectSessionBarrierState = {
  projectLoaded: boolean; // projectLoaded 来自后端项目会话，不代表页面缓存已 ready
  projectPath: string; // projectPath 是当前 session 身份
  projectSectionRevisions: ProjectDataSectionRevisions; // projectSectionRevisions 是页面缓存追赶的目标版本
  projectSessionReady: boolean; // projectSessionReady 只表示 ProjectStore 完整初始化已完成
  pageCaches: Partial<Record<ProjectSessionPageCacheKind, ProjectSessionPageCacheSnapshot>>; // pageCaches 只包含当前挂载页面
};

/**
 * 创建操作级 checkpoint；调用方用它避免异步等待期间项目切换造成误判。
 */
export function createProjectSessionBarrierCheckpoint(
  args: Pick<ProjectSessionBarrierState, "projectPath">,
): ProjectSessionBarrierCheckpoint {
  return {
    projectPath: args.projectPath,
  };
}

// resolveTargetProjectPath 统一解析显式目标、checkpoint 和当前 session 路径的优先级。
function resolveTargetProjectPath(
  state: ProjectSessionBarrierState,
  options: ProjectSessionBarrierOptions,
): string {
  const explicitProjectPath = options.projectPath?.trim() ?? "";
  if (explicitProjectPath !== "") {
    return explicitProjectPath;
  }

  const checkpointProjectPath = options.checkpoint?.projectPath.trim() ?? "";
  if (checkpointProjectPath !== "") {
    return checkpointProjectPath;
  }

  return state.projectPath;
}

/**
 * 派生缓存只在声明依赖的 section revision 全部覆盖当前 ProjectStore 时才算 ready。
 */
function coversProjectDataRevisions(args: {
  consumedRevisions: ProjectDataSectionRevisions;
  currentRevisions: ProjectDataSectionRevisions;
  requiredSections: ProjectDataSection[];
}): boolean {
  return args.requiredSections.every((section) => {
    return (args.consumedRevisions[section] ?? 0) >= (args.currentRevisions[section] ?? 0);
  });
}

// isProjectSessionReady 只判断 session 事实是否 ready，不等待任何页面派生缓存。
function isProjectSessionReady(
  state: ProjectSessionBarrierState,
  targetProjectPath: string,
): boolean {
  if (!state.projectLoaded || targetProjectPath === "") {
    return false;
  }

  return state.projectPath === targetProjectPath && state.projectSessionReady;
}

// isPageCacheReady 把未挂载页面视为无缓存义务，避免不可见页面阻塞 session 流程。
function isPageCacheReady(args: {
  state: ProjectSessionBarrierState;
  cacheKind: ProjectSessionPageCacheKind;
  targetProjectPath: string;
}): boolean {
  const cacheState = args.state.pageCaches[args.cacheKind];
  if (cacheState === undefined) {
    return true;
  }

  if (!args.state.projectLoaded) {
    return true;
  }

  if (args.targetProjectPath !== "" && args.state.projectPath !== args.targetProjectPath) {
    return true;
  }

  if (cacheState.settledProjectPath !== args.targetProjectPath) {
    return false;
  }

  if (cacheState.isRefreshing) {
    return false;
  }

  return coversProjectDataRevisions({
    consumedRevisions: cacheState.consumedRevisions,
    currentRevisions: args.state.projectSectionRevisions,
    requiredSections: cacheState.requiredSections,
  });
}

/**
 * 判断指定 barrier 是否满足；未挂载页面没有缓存义务，不参与阻塞。
 */
export function isProjectSessionBarrierReady(
  kind: ProjectSessionBarrierKind,
  state: ProjectSessionBarrierState,
  options: ProjectSessionBarrierOptions = {},
): boolean {
  const targetProjectPath = resolveTargetProjectPath(state, options);

  if (kind === "project_session_ready") {
    return isProjectSessionReady(state, targetProjectPath);
  }

  if (kind === "workbench_file_operation") {
    const workbenchCache = state.pageCaches.workbench;
    if (workbenchCache?.fileOperationRunning === true) {
      return false;
    }

    return (
      isPageCacheReady({ state, cacheKind: "workbench", targetProjectPath }) &&
      isPageCacheReady({ state, cacheKind: "proofreading", targetProjectPath })
    );
  }

  if (kind === "workbench_cache_refresh") {
    return isPageCacheReady({ state, cacheKind: "workbench", targetProjectPath });
  }

  return isPageCacheReady({ state, cacheKind: "proofreading", targetProjectPath });
}
