import {
  BadgeAlert,
  File,
  FileInput,
  FilePlus,
  FolderOpen,
  SquareMousePointer,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  type ComponentProps,
  type DragEvent,
  type MouseEvent,
  type MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type ProjectSnapshot,
  type SettingsSnapshot,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useProjectPagesBarrier } from "@/app/runtime/project-pages/project-pages-context";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { AppButton } from "@/widgets/app-button/app-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shadcn/card";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@/widgets/app-context-menu/app-context-menu";
import { Spinner } from "@/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { type LocaleKey, useI18n } from "@/i18n";
import { has_path_drop_payload, resolve_dropped_path } from "@/lib/file-drop";
import { cn } from "@/lib/utils";
import {
  SegmentedProgress,
  type SegmentedProgressStats,
} from "@/widgets/segmented-progress/segmented-progress";
import "@/pages/project-page/project-page.css";
import { PROJECT_FORMAT_SUPPORT_ITEMS } from "@/pages/project-page/support-formats";
import { DesktopApiError, api_fetch } from "@/app/desktop-api";
import { type ProjectStoreStage } from "@/app/project/store/project-store";
import { createProjectPrefilterClient } from "@/app/project/derived/project-prefilter-client";
import {
  build_project_state_from_draft,
  merge_prefilter_output_with_draft_items,
  run_project_prefilter,
  type ProjectDraftPayload,
  type ProjectPrefilterRunnerSettings,
} from "@/app/project/derived/project-prefilter-runner";
import {
  format_project_settings_aligned_toast,
  type ProjectSettingsAlignmentChangedFields,
} from "@/app/project/settings-alignment-toast";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type ProjectPageProps = {
  is_sidebar_collapsed: boolean;
};

type ProjectPreviewStats = {
  file_count: number;
  created_at: string;
  last_updated_at: string;
  progress_percent: number;
  translation_stats: SegmentedProgressStats;
};

type SelectedProject = {
  path: string;
  name: string;
  preview: ProjectPreviewStats | null;
};

type SelectedSource = {
  path: string;
  name: string;
  source_file_count: number;
};

type MissingRecentProjectState = {
  path: string;
} | null;

type ProjectPreviewPayload = {
  preview?: {
    path?: string;
    name?: string;
    file_count?: number;
    created_at?: string;
    updated_at?: string;
    translation_stats?: Partial<SegmentedProgressStats>;
  };
};

type ProjectSourceFilesPayload = {
  source_files?: string[];
};

type ProjectSnapshotPayload = {
  project?: {
    path?: string;
    loaded?: boolean;
  };
};

type ProjectCreatePreviewPayload = {
  draft?: ProjectDraftPayload;
};

type ProjectOpenAlignmentPreviewPayload = {
  preview?: {
    action?: string;
    draft?: ProjectDraftPayload | null;
    changed?: ProjectSettingsAlignmentChangedFields;
  };
};

type DefaultPresetSettingKey =
  | "glossary_default_preset"
  | "text_preserve_default_preset"
  | "pre_translation_replacement_default_preset"
  | "post_translation_replacement_default_preset"
  | "translation_custom_prompt_default_preset"
  | "analysis_custom_prompt_default_preset";

type DefaultPresetSettingSpec = {
  settings_key: DefaultPresetSettingKey;
  name_key: LocaleKey;
};

type SettingsPayload = {
  settings?: {
    project_save_mode?: string;
    project_fixed_path?: string;
    recent_projects?: Array<{
      path?: string;
      name?: string;
    }>;
  };
};

type PanelHeaderProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tone: "source" | "project";
};

type DropZoneCardProps = Omit<
  ComponentProps<"button">,
  "title" | "onClick" | "onDragOver" | "onDrop"
> & {
  icon: "source" | "project";
  title: string;
  tone: "source" | "project";
  is_active?: boolean;
  disabled?: boolean;
  on_click?: MouseEventHandler<HTMLButtonElement>;
  on_drag_over?: (event: DragEvent<HTMLButtonElement>) => void;
  on_drag_leave?: (event: DragEvent<HTMLButtonElement>) => void;
  on_drop?: (event: DragEvent<HTMLButtonElement>) => void;
};

type FormatSupportCardProps = {
  title: string;
  extensions: string;
};

type RecentProjectRowProps = {
  name: string;
  path: string;
  on_select: () => void;
  on_remove: () => void;
  remove_aria_label: string;
};

type ProjectPreviewPanelProps = {
  project: SelectedProject;
};

type ProjectActionButtonProps = {
  icon: LucideIcon;
  label: string;
  loading_label: string;
  is_loading: boolean;
  disabled: boolean;
  on_click: () => void;
};

type ActiveDropzone = "source" | "project" | null;

const DEFAULT_PRESET_SETTING_SPECS: DefaultPresetSettingSpec[] = [
  {
    settings_key: "glossary_default_preset",
    name_key: "project_page.create.default_presets.glossary",
  },
  {
    settings_key: "text_preserve_default_preset",
    name_key: "project_page.create.default_presets.text_preserve",
  },
  {
    settings_key: "pre_translation_replacement_default_preset",
    name_key: "project_page.create.default_presets.pre_translation_replacement",
  },
  {
    settings_key: "post_translation_replacement_default_preset",
    name_key: "project_page.create.default_presets.post_translation_replacement",
  },
  {
    settings_key: "translation_custom_prompt_default_preset",
    name_key: "project_page.create.default_presets.translation_prompt",
  },
  {
    settings_key: "analysis_custom_prompt_default_preset",
    name_key: "project_page.create.default_presets.analysis_prompt",
  },
];

function extract_file_name(file_path: string): string {
  const normalized_segments = file_path.split(/[\\/]+/u);
  return normalized_segments.at(-1) ?? file_path;
}

function extract_stem(file_name: string): string {
  return file_name.replace(/\.[^.]+$/u, "");
}

function extract_parent_dir(file_path: string): string {
  const normalized_index = Math.max(file_path.lastIndexOf("/"), file_path.lastIndexOf("\\"));
  if (normalized_index <= 0) {
    return "";
  }

  return file_path.slice(0, normalized_index);
}

function join_path(directory_path: string, file_name: string): string {
  if (directory_path === "") {
    return file_name;
  }

  const path_separator = directory_path.includes("\\") ? "\\" : "/";
  const normalized_directory = directory_path.replace(/[\\/]+$/u, "");
  return `${normalized_directory}${path_separator}${file_name}`;
}

function build_timestamp_suffix(): string {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  const second = now.getSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function build_default_project_file_name(source_path: string): string {
  const file_name = extract_file_name(source_path);
  const has_extension = file_name.lastIndexOf(".") > 0;
  const base_name = has_extension ? extract_stem(file_name) : file_name;
  return `${base_name}_${build_timestamp_suffix()}.lg`;
}

function format_project_error_message(args: {
  template: string;
  generic_text: string;
  error: unknown;
}): string {
  const error_detail = args.error instanceof Error ? args.error.message.trim() : "";

  if (error_detail === "") {
    return args.generic_text;
  } else {
    return args.template.replace("{ERROR}", error_detail);
  }
}

function append_optional_unit_label(text: string, unit_label: string): string {
  if (unit_label === "") {
    return text;
  } else {
    return `${text} ${unit_label}`;
  }
}

function normalize_count(value: unknown): number {
  const numeric_value = Number(value ?? 0);
  if (!Number.isFinite(numeric_value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric_value));
}

function normalize_percent(value: unknown): number {
  const numeric_value = Number(value ?? 0);
  if (!Number.isFinite(numeric_value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numeric_value));
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  return {
    path: String(payload.project?.path ?? ""),
    loaded: Boolean(payload.project?.loaded),
  };
}

function build_project_prefilter_settings(
  settings_snapshot: SettingsSnapshot,
): ProjectPrefilterRunnerSettings {
  return {
    source_language: settings_snapshot.source_language,
    target_language: settings_snapshot.target_language,
    mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings_snapshot.skip_duplicate_source_text_enable,
  };
}

function collect_loaded_default_preset_names(
  settings_snapshot: SettingsSnapshot,
  t: ReturnType<typeof useI18n>["t"],
): string[] {
  return DEFAULT_PRESET_SETTING_SPECS.flatMap((spec) => {
    const preset_value = String(settings_snapshot[spec.settings_key] ?? "").trim();
    if (preset_value === "") {
      return [];
    }

    return [t(spec.name_key)];
  });
}

function normalize_project_preview_translation_stats(
  preview: NonNullable<ProjectPreviewPayload["preview"]>,
): SegmentedProgressStats {
  const raw_stats = preview.translation_stats;
  const total_items = normalize_count(raw_stats?.total_items);
  const completed_count = normalize_count(raw_stats?.completed_count);
  const failed_count = normalize_count(raw_stats?.failed_count);
  const skipped_count = normalize_count(raw_stats?.skipped_count);
  const pending_count = normalize_count(
    raw_stats?.pending_count ?? total_items - completed_count - failed_count - skipped_count,
  );
  const computed_percent =
    total_items > 0 ? ((completed_count + skipped_count) / total_items) * 100 : 0;
  const raw_completion_percent = raw_stats?.completion_percent;
  let completion_percent = normalize_percent(raw_completion_percent);

  if (completion_percent === 0 && computed_percent > 0) {
    completion_percent = normalize_percent(computed_percent);
  }

  return {
    total_items,
    completed_count,
    failed_count,
    pending_count,
    skipped_count,
    completion_percent,
  };
}

function normalize_project_preview(
  project_path: string,
  fallback_name: string,
  payload: ProjectPreviewPayload,
): SelectedProject {
  const preview: NonNullable<ProjectPreviewPayload["preview"]> = payload.preview ?? {};
  const resolved_name = String(preview.name ?? fallback_name);
  const translation_stats = normalize_project_preview_translation_stats(preview);

  return {
    path: project_path,
    name: resolved_name,
    preview: {
      file_count: Number(preview.file_count ?? 0),
      created_at: String(preview.created_at ?? ""),
      last_updated_at: String(preview.updated_at ?? ""),
      progress_percent: translation_stats.completion_percent,
      translation_stats,
    },
  };
}

function open_context_menu_at_click_position(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 2,
      buttons: 2,
      view: window,
    }),
  );
}

function PanelHeader(props: PanelHeaderProps): JSX.Element {
  const Icon = props.icon;

  return (
    <CardHeader>
      <div className="project-home__panel-heading">
        <span
          className={cn(
            "project-home__panel-mark",
            props.tone === "source"
              ? "project-home__panel-mark--source"
              : "project-home__panel-mark--project",
          )}
          aria-hidden="true"
        >
          <Icon className="size-[17px] stroke-[1.9]" />
        </span>
        <div className="project-home__panel-copy">
          <CardTitle className="project-home__panel-title">{props.title}</CardTitle>
          <CardDescription className="project-home__panel-description">
            {props.subtitle}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  );
}

const DropZoneCard = forwardRef<HTMLButtonElement, DropZoneCardProps>(
  function DropZoneCard(props, ref): JSX.Element {
    const {
      icon,
      title,
      tone,
      is_active,
      disabled,
      on_click,
      on_drag_over,
      on_drag_leave,
      on_drop,
      className,
      ...button_props
    } = props;
    // 让创建与打开入口保留不同图标语义，避免 props 只传不消费导致 lint 失败。
    const Icon = icon === "source" ? FilePlus : FileInput;

    return (
      <button
        ref={ref}
        {...button_props}
        className={cn(
          "project-home__dropzone flex w-full flex-col items-center justify-center text-center",
          tone === "source" ? "project-home__dropzone--source" : "project-home__dropzone--project",
          className,
        )}
        type="button"
        disabled={disabled}
        data-drag-active={is_active ? "true" : undefined}
        onClick={on_click}
        onDragOver={on_drag_over}
        onDragLeave={on_drag_leave}
        onDrop={on_drop}
      >
        <span className="project-home__dropzone-icon">
          <Icon className="size-11 stroke-[1.8]" />
        </span>
        <p className="project-home__dropzone-title">{title}</p>
      </button>
    );
  },
);

function FormatSupportCard(props: FormatSupportCardProps): JSX.Element {
  return (
    <div className="project-home__format-item">
      <h3 className="project-home__format-title">{props.title}</h3>
      <p className="project-home__format-extensions">{props.extensions}</p>
    </div>
  );
}

function RecentProjectRow(props: RecentProjectRowProps): JSX.Element {
  function handle_remove_click(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    props.on_remove();
  }

  return (
    <div className="project-home__recent-row">
      <button className="project-home__recent-main" type="button" onClick={props.on_select}>
        <span className="project-home__recent-icon">
          <File className="size-[18px] stroke-[1.8]" />
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 text-left">
              <span className="project-home__recent-name">{props.name}</span>
              <span className="project-home__recent-path">{props.path}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={8}
            className="max-w-[512px] break-all"
          >
            {props.path}
          </TooltipContent>
        </Tooltip>
      </button>

      <AppButton
        variant="ghost"
        size="icon-sm"
        className="project-home__recent-remove h-7 w-7 p-0"
        onClick={handle_remove_click}
        aria-label={props.remove_aria_label}
      >
        <X className="size-4" />
      </AppButton>
    </div>
  );
}

function RecentProjectEmptyState(): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="project-home__recent-empty">
      <BadgeAlert className="project-home__recent-empty-icon size-16 stroke-[1.9]" />
      <p className="project-home__recent-empty-text">{t("project_page.open.empty")}</p>
    </div>
  );
}

function ProjectPreviewPanel(props: ProjectPreviewPanelProps): JSX.Element {
  const { t } = useI18n();
  const preview = props.project.preview;
  if (preview === null) {
    return <></>;
  }
  const rows_unit = t("project_page.preview.rows_unit");
  const translated_label = append_optional_unit_label(
    `${t("project_page.preview.translated")} ${preview.translation_stats.completed_count.toLocaleString()}`,
    rows_unit,
  );
  const skipped_label = append_optional_unit_label(
    `${t("project_page.preview.skipped")} ${preview.translation_stats.skipped_count.toLocaleString()}`,
    rows_unit,
  );
  const total_label = append_optional_unit_label(
    `${t("project_page.preview.total")} ${preview.translation_stats.total_items.toLocaleString()}`,
    rows_unit,
  );

  const stats = [
    {
      label: t("project_page.preview.project_name"),
      value: props.project.name,
    },
    {
      label: t("project_page.preview.file_count"),
      value: preview.file_count.toLocaleString(),
    },
    {
      label: t("project_page.preview.created_at"),
      value: preview.created_at,
    },
    {
      label: t("project_page.preview.updated_at"),
      value: preview.last_updated_at,
    },
  ];

  return (
    <div className="project-home__preview-panel">
      <dl className="project-home__preview-list">
        {stats.map((stat) => (
          <div key={stat.label} className="project-home__preview-row">
            <dt className="project-home__preview-label">{stat.label}</dt>
            <dd className="project-home__preview-value">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="project-home__preview-progress">
        <div className="project-home__preview-row">
          <span className="project-home__preview-label">{t("project_page.preview.progress")}</span>
          <span className="project-home__preview-value">
            {preview.progress_percent.toFixed(2)}%
          </span>
        </div>
        <SegmentedProgress
          stats={preview.translation_stats}
          labels={{
            skipped: t("workbench_page.stats.translation_skipped"),
            failed: t("workbench_page.stats.translation_failed"),
            completed: t("workbench_page.stats.translation_completed"),
            pending: t("workbench_page.stats.translation_pending"),
            total: t("workbench_page.stats.total_lines"),
          }}
        />
        <div className="project-home__preview-progress-meta">
          <span>{translated_label}</span>
          <span aria-hidden="true" />
          <span>{skipped_label}</span>
          <span>{total_label}</span>
        </div>
      </div>
    </div>
  );
}

function ProjectActionButton(props: ProjectActionButtonProps): JSX.Element {
  const Icon = props.icon;

  return (
    <AppButton
      type="button"
      size="default"
      className="min-w-[152px]"
      disabled={props.disabled}
      onClick={props.on_click}
    >
      {props.is_loading ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {props.is_loading ? props.loading_label : props.label}
    </AppButton>
  );
}

function resolve_project_loading_stage_message(
  stage: ProjectStoreStage | null,
  t: ReturnType<typeof useI18n>["t"],
): string | null {
  if (stage === "project") {
    return t("project_page.loading_stages.project");
  }
  if (stage === "files") {
    return t("project_page.loading_stages.files");
  }
  if (stage === "items") {
    return t("project_page.loading_stages.items");
  }
  if (stage === "quality") {
    return t("project_page.loading_stages.quality");
  }
  if (stage === "prompts") {
    return t("project_page.loading_stages.prompts");
  }
  if (stage === "analysis") {
    return t("project_page.loading_stages.analysis");
  }
  if (stage === "proofreading") {
    return t("project_page.loading_stages.proofreading");
  }
  if (stage === "task") {
    return t("project_page.loading_stages.task");
  }

  return null;
}

function wait_for_next_animation_frame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function ProjectPage(_props: ProjectPageProps): JSX.Element {
  const {
    project_warmup_stage,
    settings_snapshot,
    set_project_snapshot,
    set_project_warmup_status,
    refresh_settings,
    refresh_task,
  } = useDesktopRuntime();
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectPagesBarrier();
  const { push_toast, push_progress_toast, update_progress_toast, dismiss_toast } =
    useDesktopToast();
  const { t } = useI18n();
  const [selected_source, set_selected_source] = useState<SelectedSource | null>(null);
  const [selected_project, set_selected_project] = useState<SelectedProject | null>(null);
  const [is_source_checking, set_is_source_checking] = useState(false);
  const [is_preview_loading, set_is_preview_loading] = useState(false);
  const [is_creating_project, set_is_creating_project] = useState(false);
  const [is_opening_project, set_is_opening_project] = useState(false);
  const [active_dropzone, set_active_dropzone] = useState<ActiveDropzone>(null);
  const [missing_recent_project, set_missing_recent_project] =
    useState<MissingRecentProjectState>(null);
  const project_loading_toast_id_ref = useRef<string | number | null>(null);
  const project_prefilter_client_ref = useRef(createProjectPrefilterClient());
  const recent_projects = settings_snapshot.recent_projects.slice(0, 5);
  const has_recent_projects = recent_projects.length > 0;

  function clear_selected_project(): void {
    set_selected_project(null);
  }

  function clear_selected_source(): void {
    set_selected_source(null);
  }

  async function refresh_recent_projects(): Promise<void> {
    await refresh_settings();
  }

  useEffect(() => {
    const project_prefilter_client = project_prefilter_client_ref.current;
    return () => {
      project_prefilter_client.dispose();
    };
  }, []);

  useEffect(() => {
    const toast_id = project_loading_toast_id_ref.current;
    const next_message = resolve_project_loading_stage_message(project_warmup_stage, t);
    const normalized_message = next_message?.trim() ?? "";

    if (toast_id === null || normalized_message === "") {
      return;
    }

    update_progress_toast(toast_id, {
      message: normalized_message,
      presentation: "modal",
    });
  }, [project_warmup_stage, t, update_progress_toast]);

  async function run_project_loading_modal(args: {
    initial_message: string;
    task: () => Promise<void>;
  }): Promise<void> {
    const toast_id = push_progress_toast({
      message: args.initial_message,
      presentation: "modal",
    });
    project_loading_toast_id_ref.current = toast_id;

    try {
      await args.task();
      await wait_for_next_animation_frame();
    } finally {
      if (project_loading_toast_id_ref.current === toast_id) {
        project_loading_toast_id_ref.current = null;
      }
      dismiss_toast(toast_id);
    }
  }

  async function select_project_path(
    project_path: string,
    recent_project_name?: string,
  ): Promise<void> {
    const fallback_name =
      recent_project_name === undefined || recent_project_name === ""
        ? extract_stem(extract_file_name(project_path))
        : recent_project_name;

    set_is_preview_loading(true);
    set_selected_project({
      path: project_path,
      name: fallback_name,
      preview: null,
    });

    try {
      const payload = await api_fetch<ProjectPreviewPayload>("/api/project/preview", {
        path: project_path,
      });
      set_selected_project(normalize_project_preview(project_path, fallback_name, payload));
    } catch (error) {
      if (
        recent_project_name !== undefined &&
        error instanceof DesktopApiError &&
        error.code === "not_found"
      ) {
        set_missing_recent_project({
          path: project_path,
        });
      } else {
        push_toast(
          "warning",
          format_project_error_message({
            template: t("project_page.open.preview_unavailable"),
            generic_text: t("project_page.open.preview_unavailable_generic"),
            error,
          }),
        );
      }

      set_selected_project(null);
    } finally {
      set_is_preview_loading(false);
    }
  }

  async function handle_select_source_path(source_path: string): Promise<void> {
    set_is_source_checking(true);

    try {
      const payload = await api_fetch<ProjectSourceFilesPayload>("/api/project/source-files", {
        path: source_path,
      });
      const source_files = Array.isArray(payload.source_files) ? payload.source_files : [];

      if (source_files.length === 0) {
        set_selected_source(null);
        push_toast("warning", t("project_page.create.unavailable"));
      } else {
        set_selected_source({
          path: source_path,
          name: extract_file_name(source_path),
          source_file_count: source_files.length,
        });
      }
    } catch {
      set_selected_source(null);
      push_toast("warning", t("project_page.create.unavailable"));
    } finally {
      set_is_source_checking(false);
    }
  }

  async function handle_select_source_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceFilePath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_path(selected_path);
  }

  async function handle_select_source_folder(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceDirectoryPath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_path(selected_path);
  }

  async function handle_select_project_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectFilePath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await select_project_path(selected_path);
  }

  function handle_drop_over(
    dropzone: Exclude<ActiveDropzone, null>,
    event: DragEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault();

    if (has_path_drop_payload(event.dataTransfer)) {
      set_active_dropzone(dropzone);
      event.dataTransfer.dropEffect = "copy";
    } else {
      set_active_dropzone((current_dropzone) => {
        if (current_dropzone === dropzone) {
          return null;
        } else {
          return current_dropzone;
        }
      });
      event.dataTransfer.dropEffect = "none";
    }
  }

  function handle_drop_leave(dropzone: Exclude<ActiveDropzone, null>): void {
    set_active_dropzone((current_dropzone) => {
      if (current_dropzone === dropzone) {
        return null;
      } else {
        return current_dropzone;
      }
    });
  }

  async function handle_path_drop(
    event: DragEvent<HTMLButtonElement>,
    on_resolved_path: (path: string) => Promise<void>,
  ): Promise<void> {
    event.preventDefault();
    set_active_dropzone(null);

    const dropped_path = resolve_dropped_path(event.dataTransfer);
    if (dropped_path.has_multiple_paths) {
      push_toast("warning", t("project_page.drop_multiple_unavailable"));
      return;
    }
    if (dropped_path.path === null || dropped_path.path === "") {
      push_toast("warning", t("project_page.drop_unavailable"));
      return;
    }

    await on_resolved_path(dropped_path.path);
  }

  async function handle_source_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    await handle_path_drop(event, handle_select_source_path);
  }

  async function handle_project_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    await handle_path_drop(event, select_project_path);
  }

  async function resolve_project_output_path(source_path: string): Promise<string | null> {
    const default_file_name = build_default_project_file_name(source_path);
    const save_mode = settings_snapshot.project_save_mode;

    if (save_mode === "MANUAL") {
      const result = await window.desktopApp.pickProjectSavePath(default_file_name);
      return result.canceled ? null : (result.paths[0] ?? null);
    }

    if (save_mode === "SOURCE") {
      const parent_dir = extract_parent_dir(source_path);
      return join_path(parent_dir, default_file_name);
    }

    let fixed_directory = settings_snapshot.project_fixed_path;
    if (fixed_directory === "") {
      const result = await window.desktopApp.pickFixedProjectDirectory();
      const selected_path = result.paths[0] ?? null;
      if (result.canceled || selected_path === null) {
        return null;
      }

      fixed_directory = selected_path;
      await api_fetch<SettingsPayload>("/api/settings/update", {
        project_fixed_path: fixed_directory,
      });
      await refresh_recent_projects();
    }

    return join_path(fixed_directory, default_file_name);
  }

  async function handle_create_project(): Promise<void> {
    if (selected_source === null || is_creating_project) {
      return;
    }

    set_is_creating_project(true);

    try {
      const loaded_default_preset_names = collect_loaded_default_preset_names(settings_snapshot, t);
      const output_path = await resolve_project_output_path(selected_source.path);
      if (output_path === null || output_path === "") {
        return;
      }
      const normalized_output_path = output_path.endsWith(".lg")
        ? output_path
        : `${output_path}.lg`;
      const barrier_checkpoint = create_barrier_checkpoint();

      await run_project_loading_modal({
        initial_message: t("project_page.create.loading_toast"),
        task: async () => {
          const preview_payload = await api_fetch<ProjectCreatePreviewPayload>(
            "/api/project/create-preview",
            {
              source_path: selected_source.path,
            },
          );
          const draft = preview_payload.draft ?? {};
          const prefilter_output = await run_project_prefilter({
            state: build_project_state_from_draft(draft),
            settings: build_project_prefilter_settings(settings_snapshot),
            executor: (input) => {
              return project_prefilter_client_ref.current.compute(input);
            },
          });
          const payload = await api_fetch<ProjectSnapshotPayload>("/api/project/create-commit", {
            source_path: selected_source.path,
            path: normalized_output_path,
            draft: {
              files: draft.files ?? [],
              items: merge_prefilter_output_with_draft_items({
                draft_items: draft.items ?? [],
                output_items: prefilter_output.items,
              }),
            },
            translation_extras: prefilter_output.translation_extras,
            prefilter_config: prefilter_output.prefilter_config,
            project_settings: prefilter_output.project_settings,
          });
          set_project_warmup_status("warming");
          set_project_snapshot(normalize_project_snapshot(payload));
          await api_fetch<SettingsPayload>("/api/settings/recent-projects/add", {
            path: normalized_output_path,
            name: extract_stem(extract_file_name(normalized_output_path)),
          });
          await Promise.all([
            refresh_recent_projects(),
            refresh_task(),
            wait_for_barrier("project_warmup", {
              projectPath: normalized_output_path,
              checkpoint: barrier_checkpoint,
            }),
          ]);
        },
      });
      if (loaded_default_preset_names.length > 0) {
        push_toast(
          "info",
          t("project_page.create.default_preset_loaded").replace(
            "{NAMES}",
            loaded_default_preset_names.join(" | "),
          ),
        );
      }
      clear_selected_source();
      clear_selected_project();
    } catch (error) {
      push_toast(
        "error",
        format_project_error_message({
          template: t("project_page.create.failed"),
          generic_text: t("project_page.create.failed_generic"),
          error,
        }),
      );
      return;
    } finally {
      set_is_creating_project(false);
    }
  }

  async function handle_open_project(): Promise<void> {
    if (selected_project === null || selected_project.preview === null || is_opening_project) {
      return;
    }

    set_is_opening_project(true);

    try {
      const project_to_open = selected_project;
      const barrier_checkpoint = create_barrier_checkpoint();
      let did_align_project_settings = false;
      let aligned_changed_fields: ProjectSettingsAlignmentChangedFields = {};

      await run_project_loading_modal({
        initial_message: t("project_page.open.loading_toast"),
        task: async () => {
          const alignment_payload = await api_fetch<ProjectOpenAlignmentPreviewPayload>(
            "/api/project/open-preview",
            {
              path: project_to_open.path,
            },
          );
          const alignment_preview = alignment_payload.preview ?? {};
          const alignment_action = String(alignment_preview.action ?? "load");
          const alignment_settings = build_project_prefilter_settings(settings_snapshot);
          const alignment_changed_fields = alignment_preview.changed ?? {};

          if (alignment_action === "settings_only") {
            await api_fetch("/api/project/settings-alignment/apply", {
              path: project_to_open.path,
              mode: "settings_only",
              project_settings: alignment_settings,
            });
            did_align_project_settings = true;
            aligned_changed_fields = alignment_changed_fields;
          } else if (alignment_action === "prefiltered_items") {
            const draft = alignment_preview.draft ?? {};
            const prefilter_output = await run_project_prefilter({
              state: build_project_state_from_draft(draft),
              settings: alignment_settings,
              executor: (input) => {
                return project_prefilter_client_ref.current.compute(input);
              },
            });
            await api_fetch("/api/project/settings-alignment/apply", {
              path: project_to_open.path,
              mode: "prefiltered_items",
              items: merge_prefilter_output_with_draft_items({
                draft_items: draft.items ?? [],
                output_items: prefilter_output.items,
              }),
              translation_extras: prefilter_output.translation_extras,
              prefilter_config: prefilter_output.prefilter_config,
              project_settings: prefilter_output.project_settings,
              expected_section_revisions: {
                items: Number(draft.section_revisions?.items ?? 0),
                analysis: Number(draft.section_revisions?.analysis ?? 0),
              },
            });
            did_align_project_settings = true;
            aligned_changed_fields = alignment_changed_fields;
          }

          const payload = await api_fetch<ProjectSnapshotPayload>("/api/project/load", {
            path: project_to_open.path,
          });
          set_project_warmup_status("warming");
          set_project_snapshot(normalize_project_snapshot(payload));
          await api_fetch<SettingsPayload>("/api/settings/recent-projects/add", {
            path: project_to_open.path,
            name: project_to_open.name,
          });
          await Promise.all([
            refresh_recent_projects(),
            refresh_task(),
            wait_for_barrier("project_warmup", {
              projectPath: project_to_open.path,
              checkpoint: barrier_checkpoint,
            }),
          ]);
        },
      });
      if (did_align_project_settings) {
        push_toast(
          "info",
          format_project_settings_aligned_toast({
            settings: build_project_prefilter_settings(settings_snapshot),
            changed_fields: aligned_changed_fields,
            t,
          }),
        );
      }
    } catch (error) {
      push_toast(
        "error",
        format_project_error_message({
          template: t("project_page.open.failed"),
          generic_text: t("project_page.open.failed_generic"),
          error,
        }),
      );
      return;
    } finally {
      set_is_opening_project(false);
    }
  }

  async function handle_recent_project_select(
    project_path: string,
    project_name: string,
  ): Promise<void> {
    await select_project_path(project_path, project_name);
  }

  async function handle_recent_project_remove(project_path: string): Promise<void> {
    try {
      await api_fetch<SettingsPayload>("/api/settings/recent-projects/remove", {
        path: project_path,
      });
      await refresh_recent_projects();
    } catch (error) {
      push_toast(
        "error",
        error instanceof Error ? error.message : t("project_page.open.remove_unavailable"),
      );
    }
  }

  const source_dropzone =
    selected_source === null ? (
      <AppContextMenu>
        <AppContextMenuTrigger asChild>
          <DropZoneCard
            icon="source"
            tone="source"
            title={t("project_page.create.drop_title")}
            is_active={active_dropzone === "source"}
            disabled={is_source_checking || is_creating_project}
            on_click={open_context_menu_at_click_position}
            on_drag_over={(event) => {
              handle_drop_over("source", event);
            }}
            on_drag_leave={() => {
              handle_drop_leave("source");
            }}
            on_drop={(event) => {
              void handle_source_drop(event);
            }}
          />
        </AppContextMenuTrigger>
        <AppContextMenuContent>
          <AppContextMenuItem
            onSelect={() => {
              void handle_select_source_file();
            }}
          >
            <File className="size-4" />
            {t("app.action.select_file")}
          </AppContextMenuItem>
          <AppContextMenuItem
            onSelect={() => {
              void handle_select_source_folder();
            }}
          >
            <FolderOpen className="size-4" />
            {t("app.action.select_folder")}
          </AppContextMenuItem>
        </AppContextMenuContent>
      </AppContextMenu>
    ) : (
      <div
        className="project-home__selected-card project-home__selected-card--source relative"
        data-drag-active={active_dropzone === "source" ? "true" : undefined}
      >
        <AppButton
          variant="ghost"
          size="icon-sm"
          className="project-home__selected-close h-[30px] w-[30px] p-0"
          onClick={clear_selected_source}
          aria-label={t("app.action.reset")}
        >
          <X className="size-4" />
        </AppButton>

        <AppContextMenu>
          <AppContextMenuTrigger asChild>
            <button
              className="project-home__selected-content w-full"
              type="button"
              onClick={open_context_menu_at_click_position}
              onDragOver={(event) => {
                handle_drop_over("source", event);
              }}
              onDragLeave={() => {
                handle_drop_leave("source");
              }}
              onDrop={(event) => {
                void handle_source_drop(event);
              }}
            >
              <span className="project-home__dropzone-icon">
                <SquareMousePointer className="size-11 stroke-[1.85]" />
              </span>
              <div className="project-home__selected-summary">
                <p className="project-home__selected-name">{selected_source.name}</p>
                <p className="project-home__selected-status">
                  {t("project_page.create.ready_status").replace(
                    "{COUNT}",
                    selected_source.source_file_count.toString(),
                  )}
                </p>
              </div>
            </button>
          </AppContextMenuTrigger>
          <AppContextMenuContent>
            <AppContextMenuItem
              onSelect={() => {
                void handle_select_source_file();
              }}
            >
              <File className="size-4" />
              {t("app.action.select_file")}
            </AppContextMenuItem>
            <AppContextMenuItem
              onSelect={() => {
                void handle_select_source_folder();
              }}
            >
              <FolderOpen className="size-4" />
              {t("app.action.select_folder")}
            </AppContextMenuItem>
          </AppContextMenuContent>
        </AppContextMenu>
      </div>
    );

  const open_dropzone =
    selected_project === null ? (
      <DropZoneCard
        icon="project"
        tone="project"
        title={t("project_page.open.drop_title")}
        is_active={active_dropzone === "project"}
        disabled={is_preview_loading || is_opening_project}
        on_click={() => {
          void handle_select_project_file();
        }}
        on_drag_over={(event) => {
          handle_drop_over("project", event);
        }}
        on_drag_leave={() => {
          handle_drop_leave("project");
        }}
        on_drop={(event) => {
          void handle_project_drop(event);
        }}
      />
    ) : (
      <div
        className="project-home__selected-card project-home__selected-card--project relative"
        data-drag-active={active_dropzone === "project" ? "true" : undefined}
      >
        <AppButton
          variant="ghost"
          size="icon-sm"
          className="project-home__selected-close h-[30px] w-[30px] p-0"
          onClick={clear_selected_project}
          aria-label={t("app.action.reset")}
        >
          <X className="size-4" />
        </AppButton>

        <button
          className="project-home__selected-content w-full"
          type="button"
          onClick={() => {
            void handle_select_project_file();
          }}
          onDragOver={(event) => {
            handle_drop_over("project", event);
          }}
          onDragLeave={() => {
            handle_drop_leave("project");
          }}
          onDrop={(event) => {
            void handle_project_drop(event);
          }}
        >
          <span className="project-home__dropzone-icon">
            <SquareMousePointer className="size-11 stroke-[1.85]" />
          </span>
          <div className="project-home__selected-summary">
            <p className="project-home__selected-name">
              {extract_file_name(selected_project.path)}
            </p>
            <p className="project-home__selected-status">{t("project_page.open.ready_status")}</p>
          </div>
        </button>
      </div>
    );

  const recent_project_content =
    selected_project === null ? (
      has_recent_projects ? (
        <div className="space-y-1">
          {recent_projects.map((project_item) => (
            <RecentProjectRow
              key={project_item.path}
              name={project_item.name}
              path={project_item.path}
              on_select={() => {
                void handle_recent_project_select(project_item.path, project_item.name);
              }}
              on_remove={() => {
                void handle_recent_project_remove(project_item.path);
              }}
              remove_aria_label={t("project_page.open.remove_recent_project")}
            />
          ))}
        </div>
      ) : (
        <RecentProjectEmptyState />
      )
    ) : selected_project.preview !== null ? (
      <ProjectPreviewPanel project={selected_project} />
    ) : null;
  const missing_recent_project_description =
    missing_recent_project === null ? "" : t("project_page.open.missing_file_description");

  return (
    <>
      <AppAlertDialog
        open={missing_recent_project !== null}
        description={missing_recent_project_description}
        onConfirm={() => {
          const target_path = missing_recent_project?.path;
          if (target_path === undefined) {
            return;
          }

          void (async () => {
            await api_fetch<SettingsPayload>("/api/settings/recent-projects/remove", {
              path: target_path,
            });
            await refresh_recent_projects();
            set_missing_recent_project(null);
          })();
        }}
        onClose={() => {
          set_missing_recent_project(null);
        }}
      />

      <div className="project-home page-shell page-shell--full">
        <div className="project-home__layout">
          <Card variant="panel" className="project-home__panel">
            <PanelHeader
              icon={FilePlus}
              title={t("project_page.create.title")}
              subtitle={t("project_page.create.subtitle")}
              tone="source"
            />

            <CardContent className="project-home__panel-content">
              {source_dropzone}

              <section className="project-home__panel-section">
                <h3 className="project-home__section-title">{t("project_page.formats.title")}</h3>
                <div className="project-home__format-grid">
                  {PROJECT_FORMAT_SUPPORT_ITEMS.map((format_item) => (
                    <FormatSupportCard
                      key={format_item.id}
                      title={t(format_item.title_key)}
                      extensions={format_item.extensions}
                    />
                  ))}
                </div>
              </section>
            </CardContent>

            <CardFooter className="project-home__footer">
              <ProjectActionButton
                icon={FilePlus}
                label={t("project_page.create.action")}
                loading_label={t("app.action.loading")}
                is_loading={is_creating_project}
                disabled={selected_source === null || is_source_checking || is_creating_project}
                on_click={() => {
                  void handle_create_project();
                }}
              />
            </CardFooter>
          </Card>

          <Card variant="panel" className="project-home__panel">
            <PanelHeader
              icon={FileInput}
              title={t("project_page.open.title")}
              subtitle={t("project_page.open.subtitle")}
              tone="project"
            />

            <CardContent className="project-home__panel-content">
              {open_dropzone}

              <section className="project-home__panel-section project-home__recent-section">
                <h3 className="project-home__section-title">
                  {t("project_page.open.recent_title")}
                </h3>

                <div className="project-home__recent-content">{recent_project_content}</div>
              </section>
            </CardContent>

            <CardFooter className="project-home__footer">
              <ProjectActionButton
                icon={FileInput}
                label={t("project_page.open.action")}
                loading_label={t("app.action.loading")}
                is_loading={is_opening_project}
                disabled={
                  selected_project === null ||
                  selected_project.preview === null ||
                  is_preview_loading ||
                  is_opening_project
                }
                on_click={() => {
                  void handle_open_project();
                }}
              />
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  );
}
