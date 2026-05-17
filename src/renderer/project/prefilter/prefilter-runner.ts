import type { ProjectStoreState } from "@/project/store/project-store";
import {
  compute_project_prefilter_mutation,
  type ProjectPrefilterMutationInput,
  type ProjectPrefilterMutationOutput,
} from "@/project/prefilter/prefilter-mutation-builder";
import { normalize_project_item_public_record, type ProjectItemPublicRecord } from "@base/item";
import { InternalInvariantError } from "@shared/error";

export type ProjectPrefilterRunnerSettings = {
  source_language: string;
  target_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
};

export type ProjectPrefilterRunnerExecutor = (
  input: ProjectPrefilterMutationInput,
) => Promise<ProjectPrefilterMutationOutput>;

export type ProjectDraftPayload = {
  files?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  section_revisions?: Record<string, unknown>;
};

const EMPTY_PROJECT_STATE: ProjectStoreState = {
  project: {
    path: "",
    loaded: false,
  },
  files: {},
  items: {},
  quality: {
    glossary: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    pre_replacement: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    post_replacement: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    text_preserve: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
  },
  prompts: {
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
  },
  analysis: {},
  proofreading: {
    revision: 0,
  },
  revisions: {
    projectRevision: 0,
    sections: {},
  },
};

export async function run_project_prefilter(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  settings: ProjectPrefilterRunnerSettings;
  executor?: ProjectPrefilterRunnerExecutor;
}): Promise<ProjectPrefilterMutationOutput> {
  const executor =
    args.executor ?? ((input) => Promise.resolve(compute_project_prefilter_mutation(input)));
  return await executor({
    state: args.state,
    task_snapshot: args.task_snapshot,
    source_language: args.settings.source_language,
    target_language: args.settings.target_language,
    mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
  });
}

export function build_project_state_from_draft(draft: ProjectDraftPayload): ProjectStoreState {
  const files: Record<string, Record<string, unknown>> = {};
  for (const file of draft.files ?? []) {
    const rel_path = String(file.rel_path ?? "");
    if (rel_path === "") {
      continue;
    }
    files[rel_path] = {
      rel_path,
      file_type: String(file.file_type ?? "NONE"),
      sort_index: Number(file.sort_index ?? 0),
    };
  }

  const items: Record<string, ProjectItemPublicRecord> = {};
  for (const item of draft.items ?? []) {
    const normalized_item = normalize_project_item_public_record(item);
    if (normalized_item === null) {
      continue;
    }
    items[String(normalized_item.item_id)] = normalized_item;
  }

  const section_revisions = draft.section_revisions ?? {};
  return {
    ...EMPTY_PROJECT_STATE,
    files,
    items,
    revisions: {
      projectRevision: 0,
      sections: {
        files: Number(section_revisions.files ?? 0),
        items: Number(section_revisions.items ?? 0),
        analysis: Number(section_revisions.analysis ?? 0),
      },
    },
  };
}

// 预过滤提交全量替换时必须复制完整公开 DTO，避免共享可变引用
export function collect_prefilter_public_items(
  items: Record<string, ProjectItemPublicRecord>,
): ProjectItemPublicRecord[] {
  return Object.values(items).map((item) => ({ ...item }));
}

// 打开前预过滤以草稿完整 DTO 为底，只合并预过滤真正改变的运行态字段
export function merge_prefilter_output_with_draft_items(args: {
  draft_items: Array<Record<string, unknown>>;
  output_items: Record<string, ProjectItemPublicRecord>;
}): ProjectItemPublicRecord[] {
  return args.draft_items.map((draft_item) => {
    const base_item = normalize_project_item_public_record(draft_item);
    if (base_item === null) {
      throw new InternalInvariantError({
        diagnostic_context: { reason: "prefilter_draft_requires_full_item_dto" },
      });
    }
    const runtime_item = args.output_items[String(base_item.item_id)] ?? base_item;
    return {
      ...base_item,
      dst: runtime_item.dst,
      name_dst: runtime_item.name_dst,
      status: runtime_item.status,
      text_type: runtime_item.text_type,
      retry_count: runtime_item.retry_count,
      skip_internal_filter: runtime_item.skip_internal_filter,
    };
  });
}
