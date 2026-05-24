import { Prompt } from "@base/prompt";
import { QualityRule, type QualityRuleKind } from "@base/quality";
import {
  PROJECT_DATA_SECTIONS,
  isProjectDataSection,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemFieldPatch,
  type ProjectChangeItemsPayload,
  type ProjectChangePayloadMode,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
} from "@shared/project/event";
import {
  applyProjectItemIndexChange,
  applyProjectItemIndexChangeInScope,
  cloneProjectItemIndex,
  createProjectItemIndex,
  createProjectItemIndexWriteScope,
  type ProjectItemIndex,
  type ProjectItemIndexWriteScope,
} from "@/project/store/project-item-index";

export type { ProjectDataSection, ProjectDataSectionRevisions };

export type ProjectStoreStage = ProjectDataSection;

export type ProjectStoreSectionRevisions = Partial<Record<ProjectStoreStage, number>>;

export type ProjectDataRevisionCheckpoint = {
  projectPath: string;
  sections: ProjectDataSectionRevisions;
};

type ProjectStoreProjectState = {
  path: string;
  loaded: boolean;
};

export type ProjectStoreQualityRuleSlice = {
  entries: Array<Record<string, unknown>>;
  enabled: boolean;
  mode: string;
  revision: number;
};

export type ProjectStoreQualityState = {
  glossary: ProjectStoreQualityRuleSlice;
  pre_replacement: ProjectStoreQualityRuleSlice;
  post_replacement: ProjectStoreQualityRuleSlice;
  text_preserve: ProjectStoreQualityRuleSlice;
};

export type ProjectStorePromptSlice = {
  text: string;
  enabled: boolean;
  revision: number;
};

export type ProjectStorePromptsState = {
  translation: ProjectStorePromptSlice;
  analysis: ProjectStorePromptSlice;
};

export type ProjectStoreProofreadingState = {
  revision: number;
};

export type ProjectStoreSectionStateMap = {
  project: ProjectStoreProjectState;
  files: Record<string, unknown>;
  items: ProjectItemIndex;
  quality: ProjectStoreQualityState;
  prompts: ProjectStorePromptsState;
  analysis: Record<string, unknown>;
  proofreading: ProjectStoreProofreadingState;
};

export type ProjectStoreState = ProjectStoreSectionStateMap & {
  revisions: {
    projectRevision: number;
    sections: ProjectStoreSectionRevisions;
  };
};

type ProjectStoreChangeSectionPayload = {
  payloadMode: ProjectChangePayloadMode;
  data?: unknown;
};

/**
 * 单个操作表达一次 section 替换、items/files delta 或失效标记
 */
type ProjectStoreChangeOperation = {
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  sections?: Partial<Record<ProjectDataSection, ProjectStoreChangeSectionPayload>>;
};

/**
 * ProjectStore 只应用运行态规范化后的后端项目变更或读取结果
 */
export type ProjectStoreChangeEvent = {
  eventId?: string;
  source: string;
  projectPath: string; // 后端确认的项目身份，Provider 用它阻断旧工程事件和迟到补读
  projectRevision: number;
  updatedSections: ProjectStoreStage[];
  operations: ProjectStoreChangeOperation[];
  sectionRevisions?: ProjectStoreSectionRevisions;
};

type ProjectStoreListener = () => void;
export type ProjectStoreChangeRevisionMode = "merge" | "exact";

type ProjectStoreChangeOptions = {
  revisionMode?: ProjectStoreChangeRevisionMode;
};

/**
 * ProjectStore prepare 阶段持有的局部 draft，提交前不替换当前可见 state。
 */
type ProjectStoreApplyDraft = {
  itemScope: ProjectItemIndexWriteScope | null; // itemScope 只在首次 items delta 时创建，避免无关批次复制索引
};

/**
 * 合并结果把 revision 和行级影响一起返回，供页面刷新策略选择增量或重建
 */
export type ProjectStoreChangeApplyResult = {
  applied: boolean;
  eventId?: string;
  source: string;
  projectRevision: number;
  updatedSections: ProjectStoreStage[];
  itemDelta?: {
    upsertItemIds: Array<number | string>;
    deleteItemIds: Array<number | string>;
    fieldPatch?: ProjectChangeItemFieldPatch;
    fullReplace: boolean;
  };
  fileDelta?: {
    upsertFilePaths: string[];
    deleteFilePaths: string[];
    fullReplace: boolean;
  };
  sectionRevisions: ProjectStoreSectionRevisions;
};

// isProjectStoreStage 集中表达布尔判定口径，避免调用方按局部字段猜测。
export function isProjectStoreStage(value: string): value is ProjectStoreStage {
  return isProjectDataSection(value);
}

export type ProjectStoreRevisionReader = {
  getRevisionCheckpoint?: () => ProjectDataRevisionCheckpoint;
  getState: () => { revisions?: { sections?: ProjectDataSectionRevisions } };
};

// readProjectDataSectionRevisions 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
export function readProjectDataSectionRevisions(
  projectStore: ProjectStoreRevisionReader,
): ProjectDataSectionRevisions {
  return {
    ...(projectStore.getRevisionCheckpoint?.().sections ??
      projectStore.getState().revisions?.sections),
  };
}

/**
 * 页面只读视图只能观察 ProjectStore，不能绕过运行时调度器写共享项目事实
 */
export type ProjectStoreReader = {
  getState: () => ProjectStoreState;
  getRevisionCheckpoint: () => ProjectDataRevisionCheckpoint;
  subscribe: (listener: ProjectStoreListener) => () => void;
};

/**
 * Provider 内部写入口负责消费后端 canonical 变更和补读结果
 */
export type ProjectStoreWriter = ProjectStoreReader & {
  reset: () => void;
  applyProjectChange: (
    event: ProjectStoreChangeEvent,
    options?: ProjectStoreChangeOptions,
  ) => ProjectStoreChangeApplyResult;
  applyProjectChangeBatch: (
    events: readonly ProjectStoreChangeEvent[],
    options?: ProjectStoreChangeOptions,
  ) => ProjectStoreChangeApplyResult[];
  replaceProjectData: (event: ProjectStoreChangeEvent) => ProjectStoreChangeApplyResult;
};

// createEmptyQualityRuleSlice 构造跨层载荷，保证字段形状在一个入口维护。
function createEmptyQualityRuleSlice(): ProjectStoreQualityRuleSlice {
  return {
    entries: [],
    enabled: false,
    mode: "off",
    revision: 0,
  };
}

// createEmptyPromptsState 构造跨层载荷，保证字段形状在一个入口维护。
function createEmptyPromptsState(): ProjectStorePromptsState {
  return {
    translation: {
      text: "",
      enabled: false,
      revision: 0,
    },
    analysis: {
      text: "",
      enabled: false,
      revision: 0,
    },
  };
}

// createEmptyProofreadingState 构造跨层载荷，保证字段形状在一个入口维护。
function createEmptyProofreadingState(): ProjectStoreProofreadingState {
  return {
    revision: 0,
  };
}

// INITIAL STATE 是模块级稳定契约，集中维护避免调用点散落魔术值。
const INITIAL_STATE: ProjectStoreState = {
  project: {
    path: "",
    loaded: false,
  },
  files: {},
  items: createProjectItemIndex(),
  quality: {
    glossary: createEmptyQualityRuleSlice(),
    pre_replacement: createEmptyQualityRuleSlice(),
    post_replacement: createEmptyQualityRuleSlice(),
    text_preserve: createEmptyQualityRuleSlice(),
  },
  prompts: createEmptyPromptsState(),
  analysis: {},
  proofreading: createEmptyProofreadingState(),
  revisions: {
    projectRevision: 0,
    sections: {},
  },
};

// mergeChangeRevisions 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function mergeChangeRevisions(args: {
  currentRevisions: ProjectStoreState["revisions"];
  projectRevision: number;
  updatedSections: ProjectStoreStage[];
  sectionRevisions?: ProjectStoreSectionRevisions;
}): ProjectStoreState["revisions"] {
  const next_section_revisions: ProjectStoreSectionRevisions = {
    ...args.currentRevisions.sections,
  };

  for (const [section, revision] of Object.entries(args.sectionRevisions ?? {})) {
    if (!isProjectDataSection(section)) {
      continue;
    }

    const normalized_revision = Number(revision);
    if (!Number.isFinite(normalized_revision)) {
      continue;
    }

    next_section_revisions[section] = Math.max(
      next_section_revisions[section] ?? 0,
      normalized_revision,
    );
  }

  return {
    projectRevision: Math.max(args.currentRevisions.projectRevision, args.projectRevision),
    sections: next_section_revisions,
  };
}

// resolveExactChangeRevisions 集中解析运行时决策，避免调用点复制条件判断。
function resolveExactChangeRevisions(args: {
  currentRevisions: ProjectStoreState["revisions"];
  projectRevision: number;
  updatedSections: ProjectStoreStage[];
  sectionRevisions?: ProjectStoreSectionRevisions;
}): ProjectStoreState["revisions"] {
  const next_section_revisions: ProjectStoreSectionRevisions = {
    ...args.currentRevisions.sections,
  };

  for (const section of args.updatedSections) {
    if (!isProjectDataSection(section)) {
      continue;
    }

    const explicit_revision = args.sectionRevisions?.[section];
    if (explicit_revision !== undefined) {
      next_section_revisions[section] = explicit_revision;
    }
  }

  return {
    projectRevision: Number.isFinite(args.projectRevision)
      ? args.projectRevision
      : args.currentRevisions.projectRevision,
    sections: next_section_revisions,
  };
}

/**
 * 显式 tombstone 只按公开 key 删除记录；不存在的 key 视为幂等删除
 */
function deleteSectionRecords(
  currentRecords: Record<string, unknown>,
  keys: Array<number | string> | string[] | undefined,
): Record<string, unknown> {
  if (keys === undefined || keys.length === 0) {
    return currentRecords;
  }

  const next_records = {
    ...currentRecords,
  };
  for (const key of keys) {
    delete next_records[String(key)];
  }
  return next_records;
}

// cloneProjectChangeItemFieldPatch 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function cloneProjectChangeItemFieldPatch(
  patch: ProjectChangeItemFieldPatch,
): ProjectChangeItemFieldPatch {
  return {
    ...(patch.dst === undefined ? {} : { dst: patch.dst }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.retry_count === undefined ? {} : { retry_count: patch.retry_count }),
  };
}

// areProjectChangeItemFieldPatchesEqual 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function areProjectChangeItemFieldPatchesEqual(
  left: ProjectChangeItemFieldPatch,
  right: ProjectChangeItemFieldPatch,
): boolean {
  return (
    left.dst === right.dst && left.status === right.status && left.retry_count === right.retry_count
  );
}

/**
 * items 影响归约器把行级 delta、field-patch 和 full replace 语义合并成单一结果。
 */
type ProjectStoreItemsChangeImpact = {
  touched: boolean; // touched 表示本次 event 是否影响 items 刷新判定
  upsertIds: Array<number | string>; // upsertIds 合并 upsert key 与 changedIds，供页面 delta 定位
  deleteIds: Array<number | string>; // deleteIds 保留后端 tombstone id
  fullReplace: boolean; // fullReplace 是单调标记，任意 full 语义都会强制页面重建
  fieldPatch?: ProjectChangeItemFieldPatch; // fieldPatch 仅在所有 item delta 都是同一字段补丁时保留
  canKeepFieldPatch: boolean; // canKeepFieldPatch 一旦被非 field-patch 语义打断就不再恢复
};

/**
 * files 影响归约器把 path delta 和 full replace 语义合并成单一结果。
 */
type ProjectStoreFilesChangeImpact = {
  touched: boolean; // touched 表示本次 event 是否影响 files 刷新判定
  upsertPaths: string[]; // upsertPaths 合并 upsert key 与 changedPaths
  deletePaths: string[]; // deletePaths 保留后端 tombstone path
  fullReplace: boolean; // fullReplace 是单调标记，任意 full 语义都会强制页面重建
};

/**
 * ProjectStoreChangeImpact 是单个 event 生成页面刷新信号前的中间态。
 */
type ProjectStoreChangeImpact = {
  items: ProjectStoreItemsChangeImpact;
  files: ProjectStoreFilesChangeImpact;
};

/**
 * 创建单个 ProjectChangeEvent 的影响归约器，items/files 各自独立累计。
 */
function createProjectStoreChangeImpact(): ProjectStoreChangeImpact {
  return {
    items: {
      touched: false,
      upsertIds: [],
      deleteIds: [],
      fullReplace: false,
      canKeepFieldPatch: true,
    },
    files: {
      touched: false,
      upsertPaths: [],
      deletePaths: [],
      fullReplace: false,
    },
  };
}

/**
 * item field-patch 只要被 full replace 或普通 delta 打断，就不能再作为整批优化信号。
 */
function clearProjectStoreItemFieldPatch(impact: ProjectStoreItemsChangeImpact): void {
  impact.canKeepFieldPatch = false;
  impact.fieldPatch = undefined;
}

/**
 * 同一 event 内只有完全相同的字段补丁才保留给页面缓存做轻量同步。
 */
function mergeProjectStoreItemFieldPatch(
  impact: ProjectStoreItemsChangeImpact,
  patch: ProjectChangeItemFieldPatch,
): void {
  const next_patch = cloneProjectChangeItemFieldPatch(patch);
  if (
    impact.fieldPatch !== undefined &&
    !areProjectChangeItemFieldPatchesEqual(impact.fieldPatch, next_patch)
  ) {
    clearProjectStoreItemFieldPatch(impact);
    return;
  }
  impact.fieldPatch = next_patch;
}

/**
 * 记录 items 行级 payload 的影响，fullReplace 始终按单调语义累计。
 */
function recordProjectStoreItemsPayloadImpact(
  impact: ProjectStoreItemsChangeImpact,
  payload: ProjectChangeItemsPayload,
): void {
  impact.touched = true;
  impact.upsertIds.push(...Object.keys(payload.upsert ?? {}));
  impact.upsertIds.push(...(payload.changedIds ?? []));
  impact.deleteIds.push(...(payload.deleteIds ?? []));

  if (payload.payloadMode === "section-invalidated") {
    impact.fullReplace = true;
    clearProjectStoreItemFieldPatch(impact);
    return;
  }

  if (
    payload.payloadMode === "field-patch" &&
    payload.fieldPatch !== undefined &&
    impact.canKeepFieldPatch
  ) {
    mergeProjectStoreItemFieldPatch(impact, payload.fieldPatch);
    return;
  }

  clearProjectStoreItemFieldPatch(impact);
}

/**
 * 记录 items section 级替换影响，页面必须放弃行级 delta 缓存。
 */
function recordProjectStoreItemsSectionImpact(impact: ProjectStoreItemsChangeImpact): void {
  impact.touched = true;
  impact.fullReplace = true;
  clearProjectStoreItemFieldPatch(impact);
}

/**
 * 记录 files 行级 payload 的影响，section-invalidated 不会被后续 delta 覆盖。
 */
function recordProjectStoreFilesPayloadImpact(
  impact: ProjectStoreFilesChangeImpact,
  payload: ProjectChangeFilesPayload,
): void {
  impact.touched = true;
  impact.upsertPaths.push(...Object.keys(payload.upsert ?? {}));
  impact.upsertPaths.push(...(payload.changedPaths ?? []));
  impact.deletePaths.push(...(payload.deletePaths ?? []));
  impact.fullReplace ||= payload.payloadMode === "section-invalidated";
}

/**
 * 记录 files section 级替换影响，页面必须放弃文件 delta 缓存。
 */
function recordProjectStoreFilesSectionImpact(impact: ProjectStoreFilesChangeImpact): void {
  impact.touched = true;
  impact.fullReplace = true;
}

/**
 * 汇总本次 change 对 items/files 的实际影响，供运行时和页面缓存选择增量或重建
 */
function buildProjectStoreChangeApplyResult(args: {
  state: ProjectStoreState;
  event: ProjectStoreChangeEvent;
}): ProjectStoreChangeApplyResult {
  const impact = createProjectStoreChangeImpact();

  for (const operation of args.event.operations) {
    if (operation.items !== undefined) {
      recordProjectStoreItemsPayloadImpact(impact.items, operation.items);
    }
    if (operation.files !== undefined) {
      recordProjectStoreFilesPayloadImpact(impact.files, operation.files);
    }
    const sections = operation.sections ?? {};
    if (sections.items !== undefined) {
      recordProjectStoreItemsSectionImpact(impact.items);
    }
    if (sections.files !== undefined) {
      recordProjectStoreFilesSectionImpact(impact.files);
    }
  }

  return {
    applied: true,
    ...(args.event.eventId === undefined || args.event.eventId === ""
      ? {}
      : { eventId: args.event.eventId }),
    source: args.event.source || "project_change",
    projectRevision: args.state.revisions.projectRevision,
    updatedSections: [...args.event.updatedSections],
    ...(impact.items.touched
      ? {
          itemDelta: {
            upsertItemIds: [...new Set(impact.items.upsertIds)],
            deleteItemIds: [...new Set(impact.items.deleteIds)],
            ...(impact.items.fieldPatch === undefined
              ? {}
              : { fieldPatch: impact.items.fieldPatch }),
            fullReplace: impact.items.fullReplace,
          },
        }
      : {}),
    ...(impact.files.touched
      ? {
          fileDelta: {
            upsertFilePaths: [...new Set(impact.files.upsertPaths)],
            deleteFilePaths: [...new Set(impact.files.deletePaths)],
            fullReplace: impact.files.fullReplace,
          },
        }
      : {}),
    sectionRevisions: {
      ...args.state.revisions.sections,
    },
  };
}

// 质量规则切片必须按真实 rule_type 归一，避免术语表默认值泄漏到替换规则
function normalizeQualityRuleSlice(
  rule_type: QualityRuleKind,
  value: ProjectStoreQualityRuleSlice | Record<string, unknown> | undefined,
): ProjectStoreQualityRuleSlice {
  return QualityRule.from_json(rule_type).normalize_slice(
    value ?? {},
  ) as ProjectStoreQualityRuleSlice;
}

// normalizeQualityState 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalizeQualityState(
  value: ProjectStoreQualityState | Record<string, unknown> | undefined,
): ProjectStoreQualityState {
  const candidate = value as Record<string, unknown> | undefined;

  return {
    glossary: normalizeQualityRuleSlice(
      "glossary",
      candidate?.glossary as ProjectStoreQualityRuleSlice | undefined,
    ),
    pre_replacement: normalizeQualityRuleSlice(
      "pre_replacement",
      candidate?.pre_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    post_replacement: normalizeQualityRuleSlice(
      "post_replacement",
      candidate?.post_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    text_preserve: normalizeQualityRuleSlice(
      "text_preserve",
      candidate?.text_preserve as ProjectStoreQualityRuleSlice | undefined,
    ),
  };
}

// normalizePromptSlice 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalizePromptSlice(
  value: ProjectStorePromptSlice | Record<string, unknown> | undefined,
): ProjectStorePromptSlice {
  return Prompt.translation().normalize_slice(value ?? { text: "", enabled: false, revision: 0 });
}

// normalizePromptsState 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalizePromptsState(
  value: ProjectStorePromptsState | Record<string, unknown> | undefined,
): ProjectStorePromptsState {
  const candidate = value as Record<string, unknown> | undefined;

  return {
    translation: normalizePromptSlice(
      candidate?.translation as ProjectStorePromptSlice | undefined,
    ),
    analysis: normalizePromptSlice(candidate?.analysis as ProjectStorePromptSlice | undefined),
  };
}

// normalizeProofreadingState 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalizeProofreadingState(
  value: ProjectStoreProofreadingState | Record<string, unknown> | undefined,
): ProjectStoreProofreadingState {
  if (value === undefined || value === null) {
    return createEmptyProofreadingState();
  }

  const candidate = value as {
    revision?: unknown;
  };

  return {
    revision: Number(candidate.revision ?? 0),
  };
}

// cloneProjectStoreSection 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function cloneProjectStoreSection<TStage extends ProjectStoreStage>(
  section: TStage,
  value: ProjectStoreSectionStateMap[TStage],
): ProjectStoreSectionStateMap[TStage] {
  if (section === "project") {
    return {
      ...(value as ProjectStoreProjectState),
    } as ProjectStoreSectionStateMap[TStage];
  }

  if (section === "items") {
    return cloneProjectItemIndex(value as ProjectItemIndex) as ProjectStoreSectionStateMap[TStage];
  }

  if (section === "files" || section === "analysis") {
    return {
      ...(value as Record<string, unknown>),
    } as ProjectStoreSectionStateMap[TStage];
  }

  if (section === "quality") {
    return normalizeQualityState(
      value as ProjectStoreQualityState,
    ) as ProjectStoreSectionStateMap[TStage];
  }

  if (section === "prompts") {
    return normalizePromptsState(
      value as ProjectStorePromptsState,
    ) as ProjectStoreSectionStateMap[TStage];
  }

  return normalizeProofreadingState(
    value as ProjectStoreProofreadingState,
  ) as ProjectStoreSectionStateMap[TStage];
}

// cloneState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function cloneState(state: ProjectStoreState): ProjectStoreState {
  return {
    project: cloneProjectStoreSection("project", state.project),
    files: cloneProjectStoreSection("files", state.files),
    items: cloneProjectStoreSection("items", state.items),
    quality: cloneProjectStoreSection("quality", state.quality),
    prompts: cloneProjectStoreSection("prompts", state.prompts),
    analysis: cloneProjectStoreSection("analysis", state.analysis),
    proofreading: cloneProjectStoreSection("proofreading", state.proofreading),
    revisions: {
      projectRevision: state.revisions.projectRevision,
      sections: {
        ...state.revisions.sections,
      },
    },
  };
}

// normalizeRecordMap 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalizeRecordMap(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => {
      const record = entry[1];
      return typeof record === "object" && record !== null && !Array.isArray(record);
    }),
  );
}

// analysis section 是轻量进度对象，不是 record map，必须保留 candidate_count 这类标量字段。
function normalizeAnalysisState(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

// applySectionPayloadToState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function applySectionPayloadToState(
  state: ProjectStoreState,
  section: ProjectDataSection,
  payload: ProjectStoreChangeSectionPayload,
  draft?: ProjectStoreApplyDraft,
): ProjectStoreState {
  if (payload.payloadMode !== "canonical-delta" || payload.data === undefined) {
    return state;
  }
  if (section === "project") {
    return { ...state, project: payload.data as ProjectStoreProjectState };
  }
  if (section === "files") {
    return { ...state, files: normalizeRecordMap(payload.data as Record<string, unknown>) };
  }
  if (section === "items") {
    if (draft !== undefined) {
      draft.itemScope = null;
    }
    return {
      ...state,
      items: createProjectItemIndex(payload.data as Record<string, unknown>),
    };
  }
  if (section === "quality") {
    return { ...state, quality: normalizeQualityState(payload.data as ProjectStoreQualityState) };
  }
  if (section === "prompts") {
    return { ...state, prompts: normalizePromptsState(payload.data as ProjectStorePromptsState) };
  }
  if (section === "analysis") {
    return { ...state, analysis: normalizeAnalysisState(payload.data as Record<string, unknown>) };
  }
  return {
    ...state,
    proofreading: normalizeProofreadingState(payload.data as ProjectStoreProofreadingState),
  };
}

// applyItemsPayloadToState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function applyItemsPayloadToState(
  state: ProjectStoreState,
  payload: ProjectChangeItemsPayload,
  draft?: ProjectStoreApplyDraft,
): ProjectStoreState {
  if (payload.payloadMode !== "canonical-delta" && payload.payloadMode !== "field-patch") {
    return state;
  }
  const item_scope =
    draft === undefined ? null : resolveProjectItemIndexWriteScope(draft, state.items);
  return {
    ...state,
    items:
      item_scope === null
        ? applyProjectItemIndexChange(state.items, payload)
        : applyProjectItemIndexChangeInScope(state.items, item_scope, payload),
  };
}

// applyFilesPayloadToState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function applyFilesPayloadToState(
  state: ProjectStoreState,
  payload: ProjectChangeFilesPayload,
): ProjectStoreState {
  if (payload.payloadMode !== "canonical-delta") {
    return state;
  }
  const upsert = normalizeRecordMap(payload.upsert as Record<string, unknown> | undefined);
  return {
    ...state,
    files: deleteSectionRecords(
      {
        ...state.files,
        ...upsert,
      },
      payload.deletePaths,
    ),
  };
}

// applyProjectChangeToState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function applyProjectChangeToState(args: {
  state: ProjectStoreState;
  event: ProjectStoreChangeEvent;
  revisionMode: ProjectStoreChangeRevisionMode;
  draft?: ProjectStoreApplyDraft;
}): ProjectStoreState {
  let next_state: ProjectStoreState = {
    ...args.state,
    revisions:
      args.revisionMode === "exact"
        ? resolveExactChangeRevisions({
            currentRevisions: args.state.revisions,
            projectRevision: args.event.projectRevision,
            updatedSections: args.event.updatedSections,
            sectionRevisions: args.event.sectionRevisions,
          })
        : mergeChangeRevisions({
            currentRevisions: args.state.revisions,
            projectRevision: args.event.projectRevision,
            updatedSections: args.event.updatedSections,
            sectionRevisions: args.event.sectionRevisions,
          }),
  };

  for (const operation of args.event.operations) {
    for (const [section, section_payload] of Object.entries(operation.sections ?? {})) {
      if (isProjectDataSection(section) && section_payload !== undefined) {
        next_state = applySectionPayloadToState(next_state, section, section_payload, args.draft);
      }
    }
    if (operation.items !== undefined) {
      next_state = applyItemsPayloadToState(next_state, operation.items, args.draft);
    }
    if (operation.files !== undefined) {
      next_state = applyFilesPayloadToState(next_state, operation.files);
    }
  }

  return next_state;
}

/**
 * 批量 prepare 阶段只在首次 items delta 时复制索引，失败路径不接触当前 store 状态。
 */
function createProjectStoreApplyDraft(): ProjectStoreApplyDraft {
  return {
    itemScope: null,
  };
}

// resolveProjectItemIndexWriteScope 集中解析运行时决策，避免调用点复制条件判断。
function resolveProjectItemIndexWriteScope(
  draft: ProjectStoreApplyDraft,
  index: ProjectItemIndex,
): ProjectItemIndexWriteScope {
  if (draft.itemScope === null) {
    draft.itemScope = createProjectItemIndexWriteScope(index);
  }
  return draft.itemScope;
}

/**
 * 单条变更也先准备 draft，避免一个 operation 内前半段 item delta 成功后后半段校验失败。
 */
function prepareProjectChangePatch(args: {
  state: ProjectStoreState;
  event: ProjectStoreChangeEvent;
  revisionMode: ProjectStoreChangeRevisionMode;
}): { state: ProjectStoreState; result: ProjectStoreChangeApplyResult } {
  const draft = createProjectStoreApplyDraft();
  const next_state = applyProjectChangeToState({
    state: args.state,
    event: args.event,
    revisionMode: args.revisionMode,
    draft,
  });
  return {
    state: next_state,
    result: buildProjectStoreChangeApplyResult({ state: next_state, event: args.event }),
  };
}

/**
 * 批量变更先写入本地 draft，整批成功后再提交给 store，失败时当前状态保持不变。
 */
function prepareProjectChangeBatchPatch(args: {
  state: ProjectStoreState;
  events: readonly ProjectStoreChangeEvent[];
  revisionMode: ProjectStoreChangeRevisionMode;
}): { state: ProjectStoreState; results: ProjectStoreChangeApplyResult[] } {
  const draft = createProjectStoreApplyDraft();
  let next_state = args.state;
  const results: ProjectStoreChangeApplyResult[] = [];
  for (const event of args.events) {
    next_state = applyProjectChangeToState({
      state: next_state,
      event,
      revisionMode: args.revisionMode,
      draft,
    });
    results.push(buildProjectStoreChangeApplyResult({ state: next_state, event }));
  }
  return { state: next_state, results };
}

// createProjectStore 构造跨层载荷，保证字段形状在一个入口维护。
export function createProjectStore(): ProjectStoreWriter {
  let state = cloneState(INITIAL_STATE);
  const listeners = new Set<ProjectStoreListener>();

  // notifyListeners 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function notifyListeners(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    // getState 封装类内部的非显然分支，避免调用方重复理解同一约束。
    getState(): ProjectStoreState {
      return state;
    },
    // getRevisionCheckpoint 封装类内部的非显然分支，避免调用方重复理解同一约束。
    getRevisionCheckpoint(): ProjectDataRevisionCheckpoint {
      const sections: ProjectDataSectionRevisions = {};
      for (const section of PROJECT_DATA_SECTIONS) {
        const revision = state.revisions.sections[section];
        if (revision !== undefined) {
          sections[section] = revision;
        }
      }
      return {
        projectPath: state.project.path,
        sections,
      };
    },
    // subscribe 封装类内部的非显然分支，避免调用方重复理解同一约束。
    subscribe(listener: ProjectStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // reset 封装类内部的非显然分支，避免调用方重复理解同一约束。
    reset(): void {
      state = cloneState(INITIAL_STATE);
      notifyListeners();
    },
    // applyProjectChange 封装类内部的非显然分支，避免调用方重复理解同一约束。
    applyProjectChange(
      event: ProjectStoreChangeEvent,
      options?: ProjectStoreChangeOptions,
    ): ProjectStoreChangeApplyResult {
      const revision_mode = options?.revisionMode ?? "merge";
      const applied = prepareProjectChangePatch({
        state,
        event,
        revisionMode: revision_mode,
      });
      state = applied.state;
      notifyListeners();
      return applied.result;
    },
    // applyProjectChangeBatch 封装类内部的非显然分支，避免调用方重复理解同一约束。
    applyProjectChangeBatch(
      events: readonly ProjectStoreChangeEvent[],
      options?: ProjectStoreChangeOptions,
    ): ProjectStoreChangeApplyResult[] {
      if (events.length === 0) {
        return [];
      }

      const revision_mode = options?.revisionMode ?? "merge";
      const applied = prepareProjectChangeBatchPatch({
        state,
        events,
        revisionMode: revision_mode,
      });
      state = applied.state;
      notifyListeners();
      return applied.results;
    },
    // replaceProjectData 封装类内部的非显然分支，避免调用方重复理解同一约束。
    replaceProjectData(event: ProjectStoreChangeEvent): ProjectStoreChangeApplyResult {
      // 工程初始化必须从空态一次性替换完整快照，避免页面观察到 manifest 与 section 分离的半成品。
      state = applyProjectChangeToState({
        state: cloneState(INITIAL_STATE),
        event,
        revisionMode: "exact",
      });
      notifyListeners();
      return buildProjectStoreChangeApplyResult({ state, event });
    },
  };
}
