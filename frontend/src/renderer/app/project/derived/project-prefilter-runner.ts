import type { ProjectStoreState } from "@/app/project/store/project-store";
import {
  compute_project_prefilter_mutation,
  type ProjectPrefilterMutationInput,
  type ProjectPrefilterMutationOutput,
} from "@/app/project/derived/project-prefilter";

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
  task: {},
  revisions: {
    projectRevision: 0,
    sections: {},
  },
};

export async function run_project_prefilter(args: {
  state: ProjectStoreState;
  settings: ProjectPrefilterRunnerSettings;
  executor?: ProjectPrefilterRunnerExecutor;
}): Promise<ProjectPrefilterMutationOutput> {
  const executor =
    args.executor ?? ((input) => Promise.resolve(compute_project_prefilter_mutation(input)));
  return await executor({
    state: args.state,
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

  const items: Record<string, Record<string, unknown>> = {};
  for (const item of draft.items ?? []) {
    const item_id = Number(item.id ?? item.item_id ?? 0);
    if (!Number.isInteger(item_id) || item_id <= 0) {
      continue;
    }
    items[String(item_id)] = {
      item_id,
      file_path: String(item.file_path ?? ""),
      row_number: Number(item.row ?? item.row_number ?? 0),
      src: String(item.src ?? ""),
      dst: String(item.dst ?? ""),
      name_src: item.name_src ?? null,
      name_dst: item.name_dst ?? null,
      status: String(item.status ?? "NONE"),
      text_type: String(item.text_type ?? "NONE"),
      retry_count: Number(item.retry_count ?? 0),
    };
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

export function serialize_prefilter_runtime_items(
  items: Record<string, Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return Object.values(items).map((item) => {
    return {
      id: Number(item.item_id ?? item.id ?? 0),
      file_path: String(item.file_path ?? ""),
      row: Number(item.row_number ?? item.row ?? 0),
      src: String(item.src ?? ""),
      dst: String(item.dst ?? ""),
      name_dst: item.name_dst ?? null,
      status: String(item.status ?? "NONE"),
      text_type: String(item.text_type ?? "NONE"),
      retry_count: Number(item.retry_count ?? 0),
    };
  });
}

export function merge_prefilter_output_with_draft_items(args: {
  draft_items: Array<Record<string, unknown>>;
  output_items: Record<string, Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  return args.draft_items.map((draft_item) => {
    const item_id = Number(draft_item.id ?? draft_item.item_id ?? 0);
    const runtime_item = args.output_items[String(item_id)];
    if (runtime_item === undefined) {
      return {
        ...draft_item,
        id: item_id,
      };
    }

    return {
      ...draft_item,
      id: item_id,
      dst: String(runtime_item.dst ?? ""),
      name_dst: runtime_item.name_dst ?? null,
      status: String(runtime_item.status ?? "NONE"),
      text_type: String(runtime_item.text_type ?? draft_item.text_type ?? "NONE"),
      retry_count: Number(runtime_item.retry_count ?? 0),
    };
  });
}
