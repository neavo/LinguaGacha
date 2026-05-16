import { Prompt } from "@base/prompt";
import { QualityRule } from "@base/quality";
import {
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "@base/item";
import {
  PROJECT_DATA_SECTIONS,
  isProjectDataSection,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemsPayload,
  type ProjectChangeJsonRecord,
  type ProjectChangePayloadMode,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
} from "@shared/project/event";

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
  items: Record<string, ProjectItemPublicRecord>;
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
export type ProjectStoreChangeOperation = {
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  sections?: Partial<Record<ProjectDataSection, ProjectStoreChangeSectionPayload>>;
};

/**
 * ProjectStore 只消费统一 change event，本地乐观和后端事件共用同一合并路径
 */
export type ProjectStoreChangeEvent = {
  source: string;
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
 * 合并结果把 revision 和行级影响一起返回，供页面刷新策略选择增量或重建
 */
export type ProjectStoreChangeApplyResult = {
  applied: boolean;
  projectRevision: number;
  updatedSections: ProjectStoreStage[];
  itemDelta?: {
    upsertItemIds: Array<number | string>;
    deleteItemIds: Array<number | string>;
    fullReplace: boolean;
  };
  fileDelta?: {
    upsertFilePaths: string[];
    deleteFilePaths: string[];
    fullReplace: boolean;
  };
  sectionRevisions: ProjectStoreSectionRevisions;
};

export function isProjectStoreStage(value: string): value is ProjectStoreStage {
  return isProjectDataSection(value);
}

export type ProjectStoreRevisionReader = {
  getRevisionCheckpoint?: () => ProjectDataRevisionCheckpoint;
  getState: () => { revisions?: { sections?: ProjectDataSectionRevisions } };
};

export function readProjectDataSectionRevisions(
  projectStore: ProjectStoreRevisionReader,
): ProjectDataSectionRevisions {
  return {
    ...(projectStore.getRevisionCheckpoint?.().sections ??
      projectStore.getState().revisions?.sections),
  };
}

type ProjectStoreApi = {
  getState: () => ProjectStoreState;
  getRevisionCheckpoint: () => ProjectDataRevisionCheckpoint;
  subscribe: (listener: ProjectStoreListener) => () => void;
  reset: () => void;
  applyProjectChange: (
    event: ProjectStoreChangeEvent,
    options?: ProjectStoreChangeOptions,
  ) => ProjectStoreChangeApplyResult;
  applyProjectChangeBatch: (
    events: readonly ProjectStoreChangeEvent[],
    options?: ProjectStoreChangeOptions,
  ) => ProjectStoreChangeApplyResult[];
  alignRevisions: (input: {
    projectRevision?: number;
    sectionRevisions?: ProjectStoreSectionRevisions;
  }) => void;
};

function createEmptyQualityRuleSlice(): ProjectStoreQualityRuleSlice {
  return {
    entries: [],
    enabled: false,
    mode: "off",
    revision: 0,
  };
}

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

function createEmptyProofreadingState(): ProjectStoreProofreadingState {
  return {
    revision: 0,
  };
}

const INITIAL_STATE: ProjectStoreState = {
  project: {
    path: "",
    loaded: false,
  },
  files: {},
  items: {},
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

  for (const section of args.updatedSections) {
    if (!isProjectDataSection(section)) {
      continue;
    }

    if (args.sectionRevisions?.[section] !== undefined) {
      continue;
    }

    next_section_revisions[section] = (next_section_revisions[section] ?? 0) + 1;
  }

  return {
    projectRevision: Math.max(args.currentRevisions.projectRevision, args.projectRevision),
    sections: next_section_revisions,
  };
}

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
    next_section_revisions[section] =
      explicit_revision ?? (next_section_revisions[section] ?? 0) + 1;
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

/**
 * 汇总本次 change 对 items/files 的实际影响，供运行时和页面缓存选择增量或重建
 */
function buildProjectStoreChangeApplyResult(args: {
  state: ProjectStoreState;
  event: ProjectStoreChangeEvent;
}): ProjectStoreChangeApplyResult {
  const item_upsert_ids: Array<number | string> = [];
  const item_delete_ids: Array<number | string> = [];
  const file_upsert_paths: string[] = [];
  const file_delete_paths: string[] = [];
  let has_item_delta = false;
  let has_file_delta = false;
  let item_full_replace = false;
  let file_full_replace = false;

  for (const operation of args.event.operations) {
    if (operation.items !== undefined) {
      has_item_delta = true;
      item_upsert_ids.push(...Object.keys(operation.items.upsert ?? {}));
      item_upsert_ids.push(...(operation.items.changedIds ?? []));
      item_delete_ids.push(...(operation.items.deleteIds ?? []));
      item_full_replace = operation.items.payloadMode === "section-invalidated";
    }
    if (operation.files !== undefined) {
      has_file_delta = true;
      file_upsert_paths.push(...Object.keys(operation.files.upsert ?? {}));
      file_upsert_paths.push(...(operation.files.changedPaths ?? []));
      file_delete_paths.push(...(operation.files.deletePaths ?? []));
      file_full_replace = operation.files.payloadMode === "section-invalidated";
    }
    const sections = operation.sections ?? {};
    if (sections.items !== undefined) {
      has_item_delta = true;
      item_full_replace = true;
    }
    if (sections.files !== undefined) {
      has_file_delta = true;
      file_full_replace = true;
    }
  }

  return {
    applied: true,
    projectRevision: args.state.revisions.projectRevision,
    updatedSections: [...args.event.updatedSections],
    ...(has_item_delta
      ? {
          itemDelta: {
            upsertItemIds: [...new Set(item_upsert_ids)],
            deleteItemIds: [...new Set(item_delete_ids)],
            fullReplace: item_full_replace,
          },
        }
      : {}),
    ...(has_file_delta
      ? {
          fileDelta: {
            upsertFilePaths: [...new Set(file_upsert_paths)],
            deleteFilePaths: [...new Set(file_delete_paths)],
            fullReplace: file_full_replace,
          },
        }
      : {}),
    sectionRevisions: {
      ...args.state.revisions.sections,
    },
  };
}

function normalizeQualityRuleSlice(
  value: ProjectStoreQualityRuleSlice | Record<string, unknown> | undefined,
): ProjectStoreQualityRuleSlice {
  return QualityRule.from_json("glossary").normalize_slice(
    value ?? createEmptyQualityRuleSlice(),
  ) as ProjectStoreQualityRuleSlice;
}

function normalizeQualityState(
  value: ProjectStoreQualityState | Record<string, unknown> | undefined,
): ProjectStoreQualityState {
  const candidate = value as Record<string, unknown> | undefined;

  return {
    glossary: normalizeQualityRuleSlice(
      candidate?.glossary as ProjectStoreQualityRuleSlice | undefined,
    ),
    pre_replacement: normalizeQualityRuleSlice(
      candidate?.pre_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    post_replacement: normalizeQualityRuleSlice(
      candidate?.post_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    text_preserve: normalizeQualityRuleSlice(
      candidate?.text_preserve as ProjectStoreQualityRuleSlice | undefined,
    ),
  };
}

function normalizePromptSlice(
  value: ProjectStorePromptSlice | Record<string, unknown> | undefined,
): ProjectStorePromptSlice {
  return Prompt.translation().normalize_slice(value ?? { text: "", enabled: false, revision: 0 });
}

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
    return normalizeProjectItemRecordMap(
      value as Record<string, unknown>,
    ) as ProjectStoreSectionStateMap[TStage];
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

export function snapshotProjectStoreSections(
  state: ProjectStoreState,
  sections: ProjectStoreStage[],
): Partial<ProjectStoreSectionStateMap> {
  const snapshots: Partial<ProjectStoreSectionStateMap> = {};

  for (const section of sections) {
    (snapshots as Record<ProjectStoreStage, ProjectStoreSectionStateMap[ProjectStoreStage]>)[
      section
    ] = cloneProjectStoreSection(section, state[section]);
  }

  return snapshots;
}

export function createProjectStoreReplaceSectionChange<TStage extends ProjectStoreStage>(
  section: TStage,
  value: ProjectStoreSectionStateMap[TStage],
): ProjectStoreChangeOperation {
  if (section === "files") {
    return {
      sections: {
        files: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("files", value as ProjectStoreState["files"]),
        },
      },
    };
  }

  if (section === "items") {
    return {
      sections: {
        items: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("items", value as ProjectStoreState["items"]),
        },
      },
    };
  }

  if (section === "project") {
    return {
      sections: {
        project: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("project", value as ProjectStoreProjectState),
        },
      },
    };
  }

  if (section === "quality") {
    return {
      sections: {
        quality: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("quality", value as ProjectStoreQualityState),
        },
      },
    };
  }

  if (section === "prompts") {
    return {
      sections: {
        prompts: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("prompts", value as ProjectStorePromptsState),
        },
      },
    };
  }

  if (section === "analysis") {
    return {
      sections: {
        analysis: {
          payloadMode: "canonical-delta",
          data: cloneProjectStoreSection("analysis", value as Record<string, unknown>),
        },
      },
    };
  }

  return {
    sections: {
      proofreading: {
        payloadMode: "canonical-delta",
        data: cloneProjectStoreSection("proofreading", value as ProjectStoreProofreadingState),
      },
    },
  };
}

// 本地 change 的单条 upsert 也必须是完整公开 DTO，ProjectStore 不做字段级 merge
function normalize_project_store_item_delta_record(
  item: Record<string, unknown>,
): { key: string; id: number; record: ProjectChangeJsonRecord } | null {
  const normalized_item = normalize_project_item_public_record(item);
  if (normalized_item === null) {
    throw new Error("ProjectStore.items 的 upsert 必须是完整公开 item DTO。");
  }

  return {
    key: String(normalized_item.item_id),
    id: normalized_item.item_id,
    record: { ...normalized_item } as unknown as ProjectChangeJsonRecord,
  };
}

export function createProjectStoreItemsDeltaChange(args: {
  upsertItems?: Array<Record<string, unknown>>;
  deleteIds?: Array<number | string>;
}): ProjectStoreChangeOperation {
  const upsert: Record<string, ProjectChangeJsonRecord> = {};
  const changed_ids: number[] = [];

  for (const item of args.upsertItems ?? []) {
    const normalized_item = normalize_project_store_item_delta_record(item);
    if (normalized_item === null) {
      continue;
    }

    upsert[normalized_item.key] = normalized_item.record;
    changed_ids.push(normalized_item.id);
  }

  const delete_ids = [...new Set((args.deleteIds ?? []).map((item_id) => Number(item_id)))].filter(
    (item_id) => Number.isInteger(item_id) && item_id > 0,
  );

  return {
    items: {
      payloadMode: "canonical-delta",
      ...(Object.keys(upsert).length > 0 ? { upsert, changedIds: [...new Set(changed_ids)] } : {}),
      ...(delete_ids.length > 0 ? { deleteIds: delete_ids } : {}),
    },
  };
}

export function createProjectStoreFilesDeltaChange(args: {
  upsertFiles?: Record<string, Record<string, unknown>>;
  deletePaths?: string[];
}): ProjectStoreChangeOperation {
  const upsert = Object.fromEntries(
    Object.entries(args.upsertFiles ?? {}).map(([key, file]) => {
      return [key, { ...file } as ProjectChangeJsonRecord] as const;
    }),
  );
  const delete_paths = [
    ...new Set((args.deletePaths ?? []).map((file_path) => file_path.trim()).filter(Boolean)),
  ];

  return {
    files: {
      payloadMode: "canonical-delta",
      ...(Object.keys(upsert).length > 0 ? { upsert, changedPaths: Object.keys(upsert) } : {}),
      ...(delete_paths.length > 0 ? { deletePaths: delete_paths } : {}),
    },
  };
}

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

// section replace 和 canonical delta 共用同一完整 DTO 校验，禁止瘦身 item 进入共享 store
function normalizeProjectItemRecordMap(
  value: Record<string, unknown> | undefined,
): Record<string, ProjectItemPublicRecord> {
  if (value === undefined) {
    return {};
  }
  const records: Record<string, ProjectItemPublicRecord> = {};
  for (const item of Object.values(value)) {
    const normalized_item = normalize_project_item_public_record(item);
    if (normalized_item === null) {
      throw new Error("ProjectStore.items section 必须是完整公开 item DTO map。");
    }
    records[String(normalized_item.item_id)] = normalized_item;
  }
  return records;
}

function applySectionPayloadToState(
  state: ProjectStoreState,
  section: ProjectDataSection,
  payload: ProjectStoreChangeSectionPayload,
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
    return {
      ...state,
      items: normalizeProjectItemRecordMap(payload.data as Record<string, unknown>),
    };
  }
  if (section === "quality") {
    return { ...state, quality: normalizeQualityState(payload.data as ProjectStoreQualityState) };
  }
  if (section === "prompts") {
    return { ...state, prompts: normalizePromptsState(payload.data as ProjectStorePromptsState) };
  }
  if (section === "analysis") {
    return { ...state, analysis: normalizeRecordMap(payload.data as Record<string, unknown>) };
  }
  return {
    ...state,
    proofreading: normalizeProofreadingState(payload.data as ProjectStoreProofreadingState),
  };
}

function applyItemsPayloadToState(
  state: ProjectStoreState,
  payload: ProjectChangeItemsPayload,
): ProjectStoreState {
  if (payload.payloadMode !== "canonical-delta") {
    return state;
  }
  const upsert = normalizeProjectItemRecordMap(
    payload.upsert as Record<string, unknown> | undefined,
  );
  return {
    ...state,
    items: deleteSectionRecords(
      {
        ...state.items,
        ...upsert,
      },
      payload.deleteIds,
    ) as Record<string, ProjectItemPublicRecord>,
  };
}

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

function applyProjectChangeToState(args: {
  state: ProjectStoreState;
  event: ProjectStoreChangeEvent;
  revisionMode: ProjectStoreChangeRevisionMode;
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
        next_state = applySectionPayloadToState(next_state, section, section_payload);
      }
    }
    if (operation.items !== undefined) {
      next_state = applyItemsPayloadToState(next_state, operation.items);
    }
    if (operation.files !== undefined) {
      next_state = applyFilesPayloadToState(next_state, operation.files);
    }
  }

  return next_state;
}

export function createProjectStore(): ProjectStoreApi {
  let state = cloneState(INITIAL_STATE);
  const listeners = new Set<ProjectStoreListener>();

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState(): ProjectStoreState {
      return state;
    },
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
    subscribe(listener: ProjectStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(): void {
      state = cloneState(INITIAL_STATE);
      notifyListeners();
    },
    applyProjectChange(
      event: ProjectStoreChangeEvent,
      options?: ProjectStoreChangeOptions,
    ): ProjectStoreChangeApplyResult {
      const revision_mode = options?.revisionMode ?? "merge";
      state = applyProjectChangeToState({
        state,
        event,
        revisionMode: revision_mode,
      });
      notifyListeners();
      return buildProjectStoreChangeApplyResult({ state, event });
    },
    applyProjectChangeBatch(
      events: readonly ProjectStoreChangeEvent[],
      options?: ProjectStoreChangeOptions,
    ): ProjectStoreChangeApplyResult[] {
      if (events.length === 0) {
        return [];
      }

      const revision_mode = options?.revisionMode ?? "merge";
      const results: ProjectStoreChangeApplyResult[] = [];
      for (const event of events) {
        state = applyProjectChangeToState({
          state,
          event,
          revisionMode: revision_mode,
        });
        results.push(buildProjectStoreChangeApplyResult({ state, event }));
      }
      notifyListeners();
      return results;
    },
    alignRevisions(input: {
      projectRevision?: number;
      sectionRevisions?: ProjectStoreSectionRevisions;
    }): void {
      const next_project_revision = Number(input.projectRevision);
      const next_section_revisions = input.sectionRevisions;
      if (!Number.isFinite(next_project_revision) && next_section_revisions === undefined) {
        return;
      }

      state = {
        ...state,
        revisions: mergeChangeRevisions({
          currentRevisions: state.revisions,
          projectRevision: Number.isFinite(next_project_revision)
            ? next_project_revision
            : state.revisions.projectRevision,
          updatedSections: Object.keys(next_section_revisions ?? {}).filter(isProjectDataSection),
          sectionRevisions: next_section_revisions,
        }),
      };
      notifyListeners();
    },
  };
}
