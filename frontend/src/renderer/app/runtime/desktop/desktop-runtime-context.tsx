import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RouteId } from "@/app/navigation/types";
import { api_fetch, open_event_stream, open_project_bootstrap_stream } from "@/app/desktop-api";
import {
  createProjectStoreReplaceSectionPatch,
  createProjectStore,
  isProjectStoreStage,
  type ProjectStorePatchEvent,
  type ProjectStorePatchOperation,
  type ProjectStorePatchRevisionMode,
  type ProjectStoreSectionStateMap,
  type ProjectStoreStage,
  type ProjectStoreState,
  type ProjectStoreSectionRevisions,
  snapshotProjectStoreSections,
} from "@/app/project/store/project-store";
import { createProjectBootstrapLoader } from "@/app/project/store/project-bootstrap-loader";
import {
  normalize_section_array,
  normalize_section_revisions,
  parse_event_payload,
} from "@/app/runtime/desktop/desktop-runtime-event-payload";

type RecentProjectEntry = {
  path: string;
  name: string;
};

type AppLanguage = "ZH" | "EN";

export type SettingsSnapshot = {
  app_language: AppLanguage;
  source_language: string;
  target_language: string;
  project_save_mode: string;
  project_fixed_path: string;
  output_folder_open_on_finish: boolean;
  request_timeout: number;
  preceding_lines_threshold: number;
  clean_ruby: boolean;
  deduplication_in_trans: boolean;
  deduplication_in_bilingual: boolean;
  check_kana_residue: boolean;
  check_hangeul_residue: boolean;
  check_similarity: boolean;
  write_translated_name_fields_to_file: boolean;
  auto_process_prefix_suffix_preserved_text: boolean;
  mtool_optimizer_enable: boolean;
  glossary_default_preset: string;
  pre_translation_replacement_default_preset: string;
  post_translation_replacement_default_preset: string;
  text_preserve_default_preset: string;
  translation_custom_prompt_default_preset: string;
  analysis_custom_prompt_default_preset: string;
  recent_projects: RecentProjectEntry[];
};

export type ProjectSnapshot = {
  path: string;
  loaded: boolean;
};

type TaskSnapshot = {
  task_type: string;
  status: string;
  busy: boolean;
  request_in_flight_count: number;
  line: number;
  total_line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number;
  total_output_tokens: number;
  total_input_tokens: number;
  time: number;
  start_time: number;
  analysis_candidate_count: number;
};

type ProofreadingChangeMode = "full" | "delta" | "noop";
type WorkbenchChangeScope = "global" | "file";

type ProofreadingChangeSignal = {
  seq: number;
  reason: string;
  mode: ProofreadingChangeMode;
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
};

type WorkbenchChangeSignal = {
  seq: number;
  reason: string;
  scope: WorkbenchChangeScope;
};

const WORKBENCH_REFRESH_SECTIONS = ["project", "files", "items", "analysis"];

type ProjectWarmupStatus = "idle" | "warming" | "ready";

type DesktopRuntimeContextValue = {
  hydration_ready: boolean;
  hydration_error: string | null;
  settings_snapshot: SettingsSnapshot;
  project_snapshot: ProjectSnapshot;
  task_snapshot: TaskSnapshot;
  proofreading_change_signal: ProofreadingChangeSignal;
  workbench_change_signal: WorkbenchChangeSignal;
  project_warmup_status: ProjectWarmupStatus;
  project_warmup_stage: ProjectStoreStage | null;
  pending_target_route: RouteId | null;
  is_app_language_updating: boolean;
  set_settings_snapshot: (snapshot: SettingsSnapshot) => void;
  set_project_snapshot: (snapshot: ProjectSnapshot) => void;
  set_task_snapshot: (snapshot: TaskSnapshot) => void;
  set_project_warmup_status: (status: ProjectWarmupStatus) => void;
  set_pending_target_route: (route_id: RouteId | null) => void;
  project_store: ReturnType<typeof createProjectStore>;
  commit_local_project_patch: (input: LocalProjectPatchInput) => LocalProjectPatchCommit;
  refresh_project_runtime: () => Promise<void>;
  align_project_runtime_ack: (ack: ProjectMutationAck) => void;
  update_app_language: (language: AppLanguage) => Promise<SettingsSnapshot>;
  refresh_settings: () => Promise<SettingsSnapshot>;
  refresh_task: () => Promise<TaskSnapshot>;
};

export type SettingsSnapshotPayload = {
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

type ProjectSnapshotPayload = {
  project?: Partial<ProjectSnapshot>;
};

type TaskSnapshotPayload = {
  task?: Partial<TaskSnapshot>;
};

type SettingsChangedEventPayload = {
  keys?: unknown;
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

type ProjectPatchEventPayload = {
  source?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  patch?: unknown;
  sectionRevisions?: unknown;
};

export type ProjectMutationAckPayload = {
  accepted?: unknown;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

export type ProjectMutationAck = {
  accepted: boolean;
  projectRevision: number;
  sectionRevisions: ProjectStoreSectionRevisions;
};

export type LocalProjectPatchInput = {
  source: string;
  updatedSections: ProjectStoreStage[];
  patch: ProjectStorePatchOperation[];
  rollbackPatch?: ProjectStorePatchOperation[];
};

export type LocalProjectPatchCommit = {
  previousProjectRevision: number;
  previousSectionRevisions: ProjectStoreSectionRevisions;
  previousSections: Partial<ProjectStoreSectionStateMap>;
  rollback: (source?: string) => void;
};

const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  app_language: "ZH",
  source_language: "JA",
  target_language: "ZH",
  project_save_mode: "MANUAL",
  project_fixed_path: "",
  output_folder_open_on_finish: true,
  request_timeout: 60,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_trans: true,
  deduplication_in_bilingual: true,
  check_kana_residue: true,
  check_hangeul_residue: true,
  check_similarity: true,
  write_translated_name_fields_to_file: true,
  auto_process_prefix_suffix_preserved_text: true,
  mtool_optimizer_enable: true,
  glossary_default_preset: "",
  pre_translation_replacement_default_preset: "",
  post_translation_replacement_default_preset: "",
  text_preserve_default_preset: "",
  translation_custom_prompt_default_preset: "",
  analysis_custom_prompt_default_preset: "",
  recent_projects: [],
};

const DEFAULT_PROJECT_SNAPSHOT: ProjectSnapshot = {
  path: "",
  loaded: false,
};

const DEFAULT_TASK_SNAPSHOT: TaskSnapshot = {
  task_type: "translation",
  status: "IDLE",
  busy: false,
  request_in_flight_count: 0,
  line: 0,
  total_line: 0,
  processed_line: 0,
  error_line: 0,
  total_tokens: 0,
  total_output_tokens: 0,
  total_input_tokens: 0,
  time: 0,
  start_time: 0,
  analysis_candidate_count: 0,
};

const DEFAULT_PROOFREADING_CHANGE_SIGNAL: ProofreadingChangeSignal = {
  seq: 0,
  reason: "",
  mode: "full",
  updated_sections: [],
  item_ids: [],
};

const DEFAULT_WORKBENCH_CHANGE_SIGNAL: WorkbenchChangeSignal = {
  seq: 0,
  reason: "",
  scope: "global",
};

export const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue | null>(null);

function normalize_app_language(app_language: unknown): AppLanguage {
  if (
    String(app_language ?? "")
      .trim()
      .toUpperCase() === "EN"
  ) {
    return "EN";
  }

  return "ZH";
}

function normalize_recent_projects(
  recent_projects: Array<Partial<RecentProjectEntry>> | undefined,
): RecentProjectEntry[] {
  if (!Array.isArray(recent_projects)) {
    return [];
  }

  return recent_projects
    .filter((entry) => typeof entry?.path === "string" && entry.path !== "")
    .map((entry) => ({
      path: String(entry.path),
      name: String(entry.name ?? ""),
    }));
}

export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  const snapshot = payload.settings ?? {};
  return {
    app_language: normalize_app_language(snapshot.app_language),
    source_language: String(snapshot.source_language ?? DEFAULT_SETTINGS_SNAPSHOT.source_language),
    target_language: String(snapshot.target_language ?? DEFAULT_SETTINGS_SNAPSHOT.target_language),
    project_save_mode: String(
      snapshot.project_save_mode ?? DEFAULT_SETTINGS_SNAPSHOT.project_save_mode,
    ),
    project_fixed_path: String(snapshot.project_fixed_path ?? ""),
    output_folder_open_on_finish: Boolean(
      snapshot.output_folder_open_on_finish ??
      DEFAULT_SETTINGS_SNAPSHOT.output_folder_open_on_finish,
    ),
    request_timeout: Number(snapshot.request_timeout ?? DEFAULT_SETTINGS_SNAPSHOT.request_timeout),
    preceding_lines_threshold: Number(
      snapshot.preceding_lines_threshold ?? DEFAULT_SETTINGS_SNAPSHOT.preceding_lines_threshold,
    ),
    clean_ruby: Boolean(snapshot.clean_ruby ?? DEFAULT_SETTINGS_SNAPSHOT.clean_ruby),
    deduplication_in_trans: Boolean(
      snapshot.deduplication_in_trans ?? DEFAULT_SETTINGS_SNAPSHOT.deduplication_in_trans,
    ),
    deduplication_in_bilingual: Boolean(
      snapshot.deduplication_in_bilingual ?? DEFAULT_SETTINGS_SNAPSHOT.deduplication_in_bilingual,
    ),
    check_kana_residue: Boolean(
      snapshot.check_kana_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_kana_residue,
    ),
    check_hangeul_residue: Boolean(
      snapshot.check_hangeul_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_hangeul_residue,
    ),
    check_similarity: Boolean(
      snapshot.check_similarity ?? DEFAULT_SETTINGS_SNAPSHOT.check_similarity,
    ),
    write_translated_name_fields_to_file: Boolean(
      snapshot.write_translated_name_fields_to_file ??
      DEFAULT_SETTINGS_SNAPSHOT.write_translated_name_fields_to_file,
    ),
    auto_process_prefix_suffix_preserved_text: Boolean(
      snapshot.auto_process_prefix_suffix_preserved_text ??
      DEFAULT_SETTINGS_SNAPSHOT.auto_process_prefix_suffix_preserved_text,
    ),
    mtool_optimizer_enable: Boolean(
      snapshot.mtool_optimizer_enable ?? DEFAULT_SETTINGS_SNAPSHOT.mtool_optimizer_enable,
    ),
    glossary_default_preset: String(snapshot.glossary_default_preset ?? ""),
    pre_translation_replacement_default_preset: String(
      snapshot.pre_translation_replacement_default_preset ?? "",
    ),
    post_translation_replacement_default_preset: String(
      snapshot.post_translation_replacement_default_preset ?? "",
    ),
    text_preserve_default_preset: String(snapshot.text_preserve_default_preset ?? ""),
    translation_custom_prompt_default_preset: String(
      snapshot.translation_custom_prompt_default_preset ?? "",
    ),
    analysis_custom_prompt_default_preset: String(
      snapshot.analysis_custom_prompt_default_preset ?? "",
    ),
    recent_projects: normalize_recent_projects(snapshot.recent_projects),
  };
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {};
  return {
    path: String(snapshot.path ?? ""),
    loaded: Boolean(snapshot.loaded),
  };
}

function normalize_task_snapshot(payload: TaskSnapshotPayload): TaskSnapshot {
  const snapshot = payload.task ?? {};
  return {
    task_type: String(snapshot.task_type ?? DEFAULT_TASK_SNAPSHOT.task_type),
    status: String(snapshot.status ?? DEFAULT_TASK_SNAPSHOT.status),
    busy: Boolean(snapshot.busy),
    request_in_flight_count: Number(snapshot.request_in_flight_count ?? 0),
    line: Number(snapshot.line ?? 0),
    total_line: Number(snapshot.total_line ?? 0),
    processed_line: Number(snapshot.processed_line ?? 0),
    error_line: Number(snapshot.error_line ?? 0),
    total_tokens: Number(snapshot.total_tokens ?? 0),
    total_output_tokens: Number(snapshot.total_output_tokens ?? 0),
    total_input_tokens: Number(snapshot.total_input_tokens ?? 0),
    time: Number(snapshot.time ?? 0),
    start_time: Number(snapshot.start_time ?? 0),
    analysis_candidate_count: Number(snapshot.analysis_candidate_count ?? 0),
  };
}

function merge_task_status_update(
  previous_snapshot: TaskSnapshot,
  payload: Partial<TaskSnapshot>,
): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type:
      payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    status: payload.status === undefined ? previous_snapshot.status : String(payload.status),
    busy: payload.busy === undefined ? previous_snapshot.busy : Boolean(payload.busy),
  };
}

function merge_task_progress_update(
  previous_snapshot: TaskSnapshot,
  payload: Partial<TaskSnapshot>,
): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type:
      payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    request_in_flight_count:
      payload.request_in_flight_count === undefined
        ? previous_snapshot.request_in_flight_count
        : Number(payload.request_in_flight_count),
    line: payload.line === undefined ? previous_snapshot.line : Number(payload.line),
    total_line:
      payload.total_line === undefined ? previous_snapshot.total_line : Number(payload.total_line),
    processed_line:
      payload.processed_line === undefined
        ? previous_snapshot.processed_line
        : Number(payload.processed_line),
    error_line:
      payload.error_line === undefined ? previous_snapshot.error_line : Number(payload.error_line),
    total_tokens:
      payload.total_tokens === undefined
        ? previous_snapshot.total_tokens
        : Number(payload.total_tokens),
    total_output_tokens:
      payload.total_output_tokens === undefined
        ? previous_snapshot.total_output_tokens
        : Number(payload.total_output_tokens),
    total_input_tokens:
      payload.total_input_tokens === undefined
        ? previous_snapshot.total_input_tokens
        : Number(payload.total_input_tokens),
    time: payload.time === undefined ? previous_snapshot.time : Number(payload.time),
    start_time:
      payload.start_time === undefined ? previous_snapshot.start_time : Number(payload.start_time),
    analysis_candidate_count:
      payload.analysis_candidate_count === undefined
        ? previous_snapshot.analysis_candidate_count
        : Number(payload.analysis_candidate_count),
  };
}

export function normalize_project_mutation_ack(
  payload: ProjectMutationAckPayload,
): ProjectMutationAck {
  return {
    accepted: payload.accepted === undefined ? true : Boolean(payload.accepted),
    projectRevision: Number(payload.projectRevision ?? 0),
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
  };
}

function collect_operation_records(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((record): record is Record<string, unknown> => {
      return typeof record === "object" && record !== null;
    });
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.values(value).filter((record): record is Record<string, unknown> => {
    return typeof record === "object" && record !== null;
  });
}

function is_project_store_patch_operation(value: unknown): value is ProjectStorePatchOperation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { op?: unknown }).op === "string"
  );
}

function normalize_project_patch_event(
  payload: ProjectPatchEventPayload,
): ProjectStorePatchEvent | null {
  if (!Array.isArray(payload.patch)) {
    return null;
  }

  const updated_sections = normalize_section_array(payload.updatedSections).filter(
    isProjectStoreStage,
  );
  if (updated_sections.length === 0) {
    return null;
  }

  const patch = payload.patch.filter(is_project_store_patch_operation);

  return {
    source: String(payload.source ?? "task"),
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: updated_sections,
    patch,
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions),
  };
}

function collect_project_patch_item_ids(event: ProjectStorePatchEvent): Array<number | string> {
  const item_ids: Array<number | string> = [];

  for (const operation of event.patch) {
    if (operation.op !== "merge_items" && operation.op !== "replace_items") {
      continue;
    }

    for (const item of collect_operation_records(operation.items)) {
      const raw_item_id = item.item_id ?? item.id;
      if (raw_item_id === undefined || raw_item_id === null) {
        continue;
      }

      const normalized_item_id =
        typeof raw_item_id === "number" && Number.isInteger(raw_item_id)
          ? raw_item_id
          : String(raw_item_id).trim();
      if (
        (typeof normalized_item_id === "number" && Number.isInteger(normalized_item_id)) ||
        (typeof normalized_item_id === "string" && normalized_item_id !== "")
      ) {
        item_ids.push(normalized_item_id);
      }
    }
  }

  return [...new Set(item_ids)];
}

function patch_event_includes_operation(
  event: ProjectStorePatchEvent,
  operation_names: ProjectStorePatchOperation["op"][],
): boolean {
  return event.patch.some((operation) => operation_names.includes(operation.op));
}

function resolve_proofreading_change_signal(args: {
  reason: string;
  updated_sections: ProjectStoreStage[];
  patch_event: ProjectStorePatchEvent | null;
}): {
  reason: string;
  mode: ProofreadingChangeMode;
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
} | null {
  const updated_sections = args.updated_sections;
  if (updated_sections.length === 0) {
    return null;
  }

  const has_full_input_section = updated_sections.some((section) =>
    ["project", "items", "quality"].includes(section),
  );
  const has_task_only_section = updated_sections.some((section) =>
    ["proofreading", "task"].includes(section),
  );
  if (args.patch_event === null) {
    if (has_full_input_section) {
      return {
        reason: args.reason,
        mode: "full",
        updated_sections,
        item_ids: [],
      };
    }

    if (has_task_only_section) {
      return {
        reason: args.reason,
        mode: "noop",
        updated_sections,
        item_ids: [],
      };
    }

    return null;
  }

  const patch_event = args.patch_event;
  if (
    updated_sections.includes("project") ||
    updated_sections.includes("quality") ||
    patch_event_includes_operation(patch_event, [
      "replace_project",
      "replace_quality",
      "replace_items",
    ])
  ) {
    return {
      reason: args.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
    };
  }

  if (updated_sections.every((section) => ["proofreading", "task"].includes(section))) {
    return {
      reason: args.reason,
      mode: "noop",
      updated_sections,
      item_ids: [],
    };
  }

  const item_ids = collect_project_patch_item_ids(patch_event);
  const contains_items = updated_sections.includes("items");
  const delta_sections_only = updated_sections.every((section) =>
    ["items", "proofreading", "task"].includes(section),
  );
  const delta_operations_only = patch_event.patch.every((operation) =>
    ["merge_items", "replace_proofreading", "replace_task"].includes(operation.op),
  );
  if (contains_items && item_ids.length > 0 && delta_sections_only && delta_operations_only) {
    return {
      reason: args.reason,
      mode: "delta",
      updated_sections,
      item_ids,
    };
  }

  if (contains_items || has_task_only_section) {
    return {
      reason: args.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
    };
  }

  return null;
}

function has_project_patch_rel_paths(event: ProjectStorePatchEvent): boolean {
  function has_rel_path(value: unknown): boolean {
    const rel_path = String(value ?? "").trim();
    return rel_path !== "";
  }

  for (const operation of event.patch) {
    if (
      (operation.op === "merge_items" || operation.op === "replace_items") &&
      operation.items !== undefined
    ) {
      for (const item of collect_operation_records(operation.items)) {
        if (has_rel_path(item.file_path)) {
          return true;
        }
      }
    }

    if (
      (operation.op === "merge_files" || operation.op === "replace_files") &&
      operation.files !== undefined
    ) {
      for (const file of collect_operation_records(operation.files)) {
        if (has_rel_path(file.rel_path ?? file.file_path)) {
          return true;
        }
      }
    }
  }

  return false;
}

function resolve_project_patch_task_payload(
  event: ProjectStorePatchEvent,
): Partial<TaskSnapshot> | null {
  for (const operation of event.patch) {
    if (
      operation.op !== "replace_task" ||
      typeof operation.task !== "object" ||
      operation.task === null
    ) {
      continue;
    }

    return operation.task as Partial<TaskSnapshot>;
  }

  return null;
}

function build_local_project_patch_revisions(
  current_revisions: ProjectStoreState["revisions"],
  updated_sections: ProjectStoreStage[],
): {
  projectRevision: number;
  sectionRevisions: ProjectStoreSectionRevisions;
} {
  const current_max_revision = Math.max(
    current_revisions.projectRevision,
    ...Object.values(current_revisions.sections),
  );
  const next_section_revisions: ProjectStoreSectionRevisions = {};

  for (const section of updated_sections) {
    next_section_revisions[section] = (current_revisions.sections[section] ?? 0) + 1;
  }

  return {
    projectRevision: current_max_revision + 1,
    sectionRevisions: next_section_revisions,
  };
}

function collect_previous_section_revisions(
  current_revisions: ProjectStoreState["revisions"],
  updated_sections: ProjectStoreStage[],
): ProjectStoreSectionRevisions {
  const previous_section_revisions: ProjectStoreSectionRevisions = {};

  for (const section of updated_sections) {
    previous_section_revisions[section] = current_revisions.sections[section] ?? 0;
  }

  return previous_section_revisions;
}

function build_local_project_patch_rollback_patch(args: {
  updatedSections: ProjectStoreStage[];
  previousSections: Partial<ProjectStoreSectionStateMap>;
}): ProjectStorePatchOperation[] {
  return args.updatedSections.map((section) => {
    const previous_section = args.previousSections[section];
    if (previous_section === undefined) {
      throw new Error(`缺少 ${section} 的回滚快照。`);
    }

    return createProjectStoreReplaceSectionPatch(section, previous_section);
  });
}

export function DesktopRuntimeProvider(props: { children: ReactNode }): JSX.Element {
  const [hydration_ready, set_hydration_ready] = useState(false);
  const [hydration_error, set_hydration_error] = useState<string | null>(null);
  const [settings_snapshot, set_settings_snapshot] =
    useState<SettingsSnapshot>(DEFAULT_SETTINGS_SNAPSHOT);
  const [project_snapshot, set_project_snapshot] =
    useState<ProjectSnapshot>(DEFAULT_PROJECT_SNAPSHOT);
  const [task_snapshot, set_task_snapshot] = useState<TaskSnapshot>(DEFAULT_TASK_SNAPSHOT);
  const [proofreading_change_signal, set_proofreading_change_signal] =
    useState<ProofreadingChangeSignal>(DEFAULT_PROOFREADING_CHANGE_SIGNAL);
  const [workbench_change_signal, set_workbench_change_signal] = useState<WorkbenchChangeSignal>(
    DEFAULT_WORKBENCH_CHANGE_SIGNAL,
  );
  const [project_warmup_status, set_project_warmup_status] = useState<ProjectWarmupStatus>("idle");
  const [project_warmup_stage, set_project_warmup_stage] = useState<ProjectStoreStage | null>(null);
  const [pending_target_route, set_pending_target_route] = useState<RouteId | null>(null);
  const [is_app_language_updating, set_is_app_language_updating] = useState(false);
  const project_store_ref = useRef(createProjectStore());
  const project_runtime = useMemo(() => {
    return createProjectBootstrapLoader({
      store: project_store_ref.current,
      openBootstrapStream: open_project_bootstrap_stream,
    });
  }, []);

  const apply_settings_snapshot = useCallback(
    (payload: SettingsSnapshotPayload): SettingsSnapshot => {
      const next_snapshot = normalize_settings_snapshot(payload);
      set_settings_snapshot(next_snapshot);
      return next_snapshot;
    },
    [],
  );

  const refresh_settings = useCallback(async (): Promise<SettingsSnapshot> => {
    const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/app", {});
    return apply_settings_snapshot(payload);
  }, [apply_settings_snapshot]);

  const refresh_task = useCallback(async (): Promise<TaskSnapshot> => {
    const payload = await api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", {});
    const next_snapshot = normalize_task_snapshot(payload);
    set_task_snapshot(next_snapshot);
    return next_snapshot;
  }, []);

  const update_app_language = useCallback(
    async (language: AppLanguage): Promise<SettingsSnapshot> => {
      if (is_app_language_updating || settings_snapshot.app_language === language) {
        return settings_snapshot;
      }

      set_is_app_language_updating(true);
      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          app_language: language,
        });
        return apply_settings_snapshot(payload);
      } finally {
        set_is_app_language_updating(false);
      }
    },
    [apply_settings_snapshot, is_app_language_updating, settings_snapshot],
  );

  const bump_workbench_runtime_signal = useCallback(
    (args: { reason: string; scope: WorkbenchChangeScope }): void => {
      set_workbench_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: args.reason,
        scope: args.scope,
      }));
    },
    [],
  );

  const bump_proofreading_runtime_signal = useCallback(
    (args: {
      reason: string;
      mode: ProofreadingChangeMode;
      updated_sections: ProjectStoreStage[];
      item_ids: Array<number | string>;
    }): void => {
      set_proofreading_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: args.reason,
        mode: args.mode,
        updated_sections: [...args.updated_sections],
        item_ids: [...args.item_ids],
      }));
    },
    [],
  );

  const apply_runtime_project_patch = useCallback(
    (
      patch_event: ProjectStorePatchEvent,
      revision_mode: ProjectStorePatchRevisionMode = "merge",
    ): void => {
      project_store_ref.current.applyProjectPatch(patch_event, {
        revisionMode: revision_mode,
      });

      const task_payload = resolve_project_patch_task_payload(patch_event);
      if (task_payload !== null) {
        set_task_snapshot((previous_snapshot) => {
          return merge_task_progress_update(
            merge_task_status_update(previous_snapshot, task_payload),
            task_payload,
          );
        });
      }

      const has_rel_paths = has_project_patch_rel_paths(patch_event);
      if (
        patch_event.updatedSections.some((section) => WORKBENCH_REFRESH_SECTIONS.includes(section))
      ) {
        bump_workbench_runtime_signal({
          reason: patch_event.source,
          scope: has_rel_paths ? "file" : "global",
        });
      }

      const proofreading_change_signal = resolve_proofreading_change_signal({
        reason: patch_event.source,
        updated_sections: patch_event.updatedSections,
        patch_event,
      });
      if (proofreading_change_signal !== null) {
        bump_proofreading_runtime_signal(proofreading_change_signal);
      }
    },
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal],
  );

  const refresh_project_runtime = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    set_project_warmup_status("warming");
    set_project_warmup_stage(null);
    project_store_ref.current.reset();
    await project_runtime.bootstrap(project_snapshot.path, {
      onStageStarted: (stage) => {
        set_project_warmup_stage(stage);
      },
    });
    bump_workbench_runtime_signal({
      reason: "project_bootstrap",
      scope: "global",
    });
    bump_proofreading_runtime_signal({
      reason: "project_bootstrap",
      mode: "full",
      updated_sections: ["project", "items", "quality"],
      item_ids: [],
    });
  }, [
    bump_proofreading_runtime_signal,
    bump_workbench_runtime_signal,
    project_snapshot.loaded,
    project_snapshot.path,
    set_project_warmup_status,
    project_runtime,
  ]);

  const align_project_runtime_ack = useCallback((ack: ProjectMutationAck): void => {
    if (!ack.accepted) {
      return;
    }

    project_store_ref.current.alignRevisions({
      projectRevision: ack.projectRevision,
      sectionRevisions: ack.sectionRevisions,
    });
  }, []);

  const commit_local_project_patch = useCallback(
    (input: LocalProjectPatchInput): LocalProjectPatchCommit => {
      if (input.updatedSections.length === 0) {
        throw new Error("本地 project patch 至少需要一个 updated section。");
      }

      const current_state = project_store_ref.current.getState();
      const previous_sections = snapshotProjectStoreSections(current_state, input.updatedSections);
      const previous_project_revision = current_state.revisions.projectRevision;
      const previous_section_revisions = collect_previous_section_revisions(
        current_state.revisions,
        input.updatedSections,
      );
      const next_revisions = build_local_project_patch_revisions(
        current_state.revisions,
        input.updatedSections,
      );

      apply_runtime_project_patch(
        {
          source: input.source,
          projectRevision: next_revisions.projectRevision,
          updatedSections: input.updatedSections,
          patch: input.patch,
          sectionRevisions: next_revisions.sectionRevisions,
        },
        "exact",
      );

      let rolled_back = false;
      return {
        previousProjectRevision: previous_project_revision,
        previousSectionRevisions: previous_section_revisions,
        previousSections: previous_sections,
        rollback: (source = `${input.source}_rollback`) => {
          if (rolled_back) {
            return;
          }

          rolled_back = true;
          apply_runtime_project_patch(
            {
              source,
              projectRevision: previous_project_revision,
              updatedSections: input.updatedSections,
              patch:
                input.rollbackPatch ??
                build_local_project_patch_rollback_patch({
                  updatedSections: input.updatedSections,
                  previousSections: previous_sections,
                }),
              sectionRevisions: previous_section_revisions,
            },
            "exact",
          );
        },
      };
    },
    [apply_runtime_project_patch],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate_runtime(): Promise<void> {
      try {
        // Core API 状态是共享权威源，渲染层启动或热更新时不能通过卸载工程去“重置会话”。
        // 否则开发态的 StrictMode、Fast Refresh 或整页重载都会把外部手动打开的 Py 应用状态一起清空。
        const [next_settings, next_project, next_task] = await Promise.all([
          api_fetch<SettingsSnapshotPayload>("/api/settings/app", {}),
          api_fetch<ProjectSnapshotPayload>("/api/project/snapshot", {}),
          api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", {}),
        ]);
        if (cancelled) {
          return;
        }

        apply_settings_snapshot(next_settings);
        set_project_snapshot(normalize_project_snapshot(next_project));
        set_task_snapshot(normalize_task_snapshot(next_task));
        set_hydration_error(null);
        set_hydration_ready(true);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "桌面运行时初始化失败。";
        set_hydration_error(message);
        set_hydration_ready(true);
      }
    }

    void hydrate_runtime();

    return () => {
      cancelled = true;
    };
  }, [apply_settings_snapshot]);

  useEffect(() => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    let cancelled = false;

    async function bootstrap_project_runtime(): Promise<void> {
      try {
        await refresh_project_runtime();
      } catch {
        return;
      }

      if (cancelled) {
        return;
      }
    }

    void bootstrap_project_runtime();

    return () => {
      cancelled = true;
    };
  }, [project_snapshot.loaded, project_snapshot.path, refresh_project_runtime]);

  useEffect(() => {
    if (project_warmup_status === "ready") {
      set_project_warmup_stage(null);
    }
  }, [project_warmup_status]);

  useEffect(() => {
    let event_source: EventSource | null = null;
    let cancelled = false;

    function handle_project_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event);
      set_project_snapshot({
        path: String(payload.path ?? ""),
        loaded: Boolean(payload.loaded),
      });
      void refresh_task();
    }

    function handle_task_status_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event);
      set_task_snapshot((previous_snapshot) =>
        merge_task_status_update(previous_snapshot, payload),
      );
    }

    function handle_task_progress_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event);
      set_task_snapshot((previous_snapshot) =>
        merge_task_progress_update(previous_snapshot, payload),
      );
    }

    function handle_settings_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event) as SettingsChangedEventPayload;

      if (typeof payload.settings === "object" && payload.settings !== null) {
        apply_settings_snapshot({
          settings: payload.settings,
        });
      } else {
        void refresh_settings();
      }
    }

    async function handle_project_patch(event: MessageEvent<string>): Promise<void> {
      const payload = parse_event_payload(event) as ProjectPatchEventPayload;
      const patch_event = normalize_project_patch_event(payload);
      const updated_sections = normalize_section_array(payload.updatedSections).filter(
        isProjectStoreStage,
      );
      const reason = String(payload.source ?? "project_patch");

      if (patch_event === null) {
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }

        try {
          await refresh_project_runtime();
        } catch {
          return;
        }

        if (cancelled) {
          return;
        }

        if (updated_sections.some((section) => WORKBENCH_REFRESH_SECTIONS.includes(section))) {
          bump_workbench_runtime_signal({
            reason,
            scope: "global",
          });
        }

        const proofreading_change_signal = resolve_proofreading_change_signal({
          reason,
          updated_sections,
          patch_event: null,
        });
        if (proofreading_change_signal !== null) {
          bump_proofreading_runtime_signal(proofreading_change_signal);
        }

        return;
      }

      if (cancelled) {
        return;
      }

      apply_runtime_project_patch(patch_event);
    }

    async function attach_event_stream(): Promise<void> {
      try {
        const next_event_source = await open_event_stream();
        if (cancelled) {
          next_event_source.close();
          return;
        }

        event_source = next_event_source;
        event_source.addEventListener("project.changed", handle_project_changed as EventListener);
        event_source.addEventListener(
          "task.status_changed",
          handle_task_status_changed as EventListener,
        );
        event_source.addEventListener(
          "task.progress_changed",
          handle_task_progress_changed as EventListener,
        );
        event_source.addEventListener("settings.changed", handle_settings_changed as EventListener);
        event_source.addEventListener("project.patch", ((event: MessageEvent<string>) => {
          void handle_project_patch(event);
        }) as EventListener);
      } catch {
        return;
      }
    }

    void attach_event_stream();

    return () => {
      cancelled = true;
      event_source?.close();
    };
  }, [
    apply_settings_snapshot,
    apply_runtime_project_patch,
    bump_proofreading_runtime_signal,
    bump_workbench_runtime_signal,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_settings,
    refresh_project_runtime,
    refresh_task,
  ]);

  const context_value = useMemo<DesktopRuntimeContextValue>(() => {
    return {
      hydration_ready,
      hydration_error,
      settings_snapshot,
      project_snapshot,
      task_snapshot,
      proofreading_change_signal,
      workbench_change_signal,
      project_warmup_status,
      project_warmup_stage,
      pending_target_route,
      is_app_language_updating,
      set_settings_snapshot,
      set_project_snapshot,
      set_task_snapshot,
      set_project_warmup_status,
      set_pending_target_route,
      project_store: project_store_ref.current,
      commit_local_project_patch,
      refresh_project_runtime,
      align_project_runtime_ack,
      update_app_language,
      refresh_settings,
      refresh_task,
    };
  }, [
    hydration_ready,
    hydration_error,
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    proofreading_change_signal,
    workbench_change_signal,
    project_warmup_status,
    project_warmup_stage,
    pending_target_route,
    is_app_language_updating,
    align_project_runtime_ack,
    commit_local_project_patch,
    refresh_project_runtime,
    refresh_settings,
    refresh_task,
    update_app_language,
  ]);

  return (
    <DesktopRuntimeContext.Provider value={context_value}>
      {props.children}
    </DesktopRuntimeContext.Provider>
  );
}
