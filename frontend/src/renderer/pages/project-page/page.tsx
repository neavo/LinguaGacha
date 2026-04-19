import {
  BadgeAlert,
  File,
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
  useState,
} from "react";

import { type ProjectSnapshot } from "@/app/state/desktop-runtime-context";
import { useProjectPagesBarrier } from "@/app/state/project-pages-context";
import { useDesktopToast } from "@/app/state/use-desktop-toast";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { Button } from "@/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shadcn/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shadcn/context-menu";
import { Progress } from "@/shadcn/progress";
import { Spinner } from "@/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { useI18n } from "@/i18n";
import { has_path_drop_payload, resolve_dropped_path } from "@/lib/file-drop";
import { cn } from "@/lib/utils";
import "@/pages/project-page/project-page.css";
import { PROJECT_FORMAT_SUPPORT_ITEMS } from "@/pages/project-page/support-formats";
import { DesktopApiError, api_fetch } from "@/app/desktop-api";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type ProjectPageProps = {
  is_sidebar_collapsed: boolean;
};

type ProjectPreviewStats = {
  file_count: number;
  created_at: string;
  last_updated_at: string;
  progress_percent: number;
  translated_items: number;
  total_items: number;
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
  name: string;
} | null;

type ProjectPreviewPayload = {
  preview?: {
    path?: string;
    name?: string;
    file_count?: number;
    created_at?: string;
    updated_at?: string;
    total_items?: number;
    translated_items?: number;
    progress?: number;
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
  accent_class_name: string;
  title: string;
  subtitle: string;
};

type DropZoneCardProps = Omit<
  ComponentProps<"button">,
  "title" | "onClick" | "onDragOver" | "onDrop"
> & {
  icon: "source" | "project";
  title: string;
  tone: "blue" | "purple";
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

function extract_file_name(file_path: string): string {
  const normalized_segments = file_path.split(/[\\/]+/u);
  return normalized_segments.at(-1) ?? file_path;
}

function extract_stem(file_name: string): string {
  return file_name.replace(/\.[^.]+$/u, "");
}

function extract_parent_dir(file_path: string): string {
  const normalized_index = Math.max(
    file_path.lastIndexOf("/"),
    file_path.lastIndexOf("\\"),
  );
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
  const error_detail =
    args.error instanceof Error ? args.error.message.trim() : "";

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

function normalize_project_snapshot(
  payload: ProjectSnapshotPayload,
): ProjectSnapshot {
  return {
    path: String(payload.project?.path ?? ""),
    loaded: Boolean(payload.project?.loaded),
  };
}

function normalize_project_preview(
  project_path: string,
  fallback_name: string,
  payload: ProjectPreviewPayload,
): SelectedProject {
  const preview = payload.preview ?? {};
  const resolved_name = String(preview.name ?? fallback_name);

  return {
    path: project_path,
    name: resolved_name,
    preview: {
      file_count: Number(preview.file_count ?? 0),
      created_at: String(preview.created_at ?? ""),
      last_updated_at: String(preview.updated_at ?? ""),
      progress_percent: Math.round(Number(preview.progress ?? 0) * 100),
      translated_items: Number(preview.translated_items ?? 0),
      total_items: Number(preview.total_items ?? 0),
    },
  };
}

function open_context_menu_at_click_position(
  event: MouseEvent<HTMLButtonElement>,
): void {
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
  return (
    <CardHeader>
      <div className="flex items-start gap-3">
        <span
          className={cn("project-home__section-rail", props.accent_class_name)}
          aria-hidden="true"
        />
        <div className="space-y-2">
          <CardTitle className="text-[clamp(25.92px,23.68px+0.34vw,30.72px)] leading-[1.08] tracking-[-0.028em]">
            {props.title}
          </CardTitle>
          <CardDescription className="max-w-[520px] text-[12.8px] leading-[1.45] text-[color:var(--project-home-subtitle)]">
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
    const Icon = icon === "source" ? File : FolderOpen;

    return (
      <button
        ref={ref}
        {...button_props}
        className={cn(
          "project-home__dropzone flex w-full flex-col items-center justify-center text-center",
          tone === "blue"
            ? "project-home__dropzone--blue"
            : "project-home__dropzone--purple",
          "h-[145px] px-5 py-4",
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
        <p className="mt-2.5 text-[15.36px] tracking-[-0.018em] font-medium text-foreground">
          {title}
        </p>
      </button>
    );
  },
);

function FormatSupportCard(props: FormatSupportCardProps): JSX.Element {
  return (
    <Card className="project-home__format-card">
      <CardContent className="space-y-1">
        <h3 className="text-[12.48px] leading-[1.35] tracking-[-0.015em] font-medium text-foreground">
          {props.title}
        </h3>
        <p className="text-[11.52px] leading-[1.35] text-[color:var(--project-home-muted)]">
          {props.extensions}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentProjectRow(props: RecentProjectRowProps): JSX.Element {
  function handle_remove_click(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    props.on_remove();
  }

  return (
    <div className="project-home__recent-row">
      <button
        className="project-home__recent-main"
        type="button"
        onClick={props.on_select}
      >
        <span className="project-home__recent-icon">
          <File className="size-[18px] stroke-[1.8]" />
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[12.16px] tracking-[-0.012em] font-medium text-foreground">
                {props.name}
              </span>
              <span className="mt-0.5 block truncate text-[10.56px] text-[color:var(--project-home-muted)]">
                {props.path}
              </span>
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

      <Button
        variant="ghost"
        size="icon-sm"
        className="project-home__recent-remove h-7 w-7 p-0"
        onClick={handle_remove_click}
        aria-label={props.remove_aria_label}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function RecentProjectEmptyState(): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="project-home__recent-empty">
      <BadgeAlert className="project-home__recent-empty-icon size-16 stroke-[1.9]" />
      <p className="project-home__recent-empty-text">
        {t("project_page.open.empty")}
      </p>
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
    `${t("project_page.preview.translated")} ${preview.translated_items.toLocaleString()}`,
    rows_unit,
  );
  const total_label = append_optional_unit_label(
    `${t("project_page.preview.total")} ${preview.total_items.toLocaleString()}`,
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
    <Card className="project-home__preview-card">
      <CardContent className="space-y-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center justify-between gap-5"
          >
            <span className="text-[12.32px] text-foreground">{stat.label}</span>
            <span className="max-w-[272px] break-all text-right text-[12.32px] text-foreground">
              {stat.value}
            </span>
          </div>
        ))}

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12.32px] text-foreground">
              {t("project_page.preview.progress")}
            </span>
            <span className="text-[12.32px] text-foreground">
              {preview.progress_percent}%
            </span>
          </div>
          <Progress
            value={preview.progress_percent}
            className="h-1.5 bg-muted"
          />
          <div className="flex items-center justify-between gap-4 text-[12.32px] text-foreground">
            <span>{translated_label}</span>
            <span>{total_label}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectActionButton(props: ProjectActionButtonProps): JSX.Element {
  const Icon = props.icon;

  return (
    <Button
      type="button"
      size="default"
      className="min-w-[152px]"
      disabled={props.disabled}
      onClick={props.on_click}
    >
      {props.is_loading ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      {props.is_loading ? props.loading_label : props.label}
    </Button>
  );
}

export function ProjectPage(props: ProjectPageProps): JSX.Element {
  const {
    settings_snapshot,
    set_project_snapshot,
    refresh_settings,
    refresh_task,
  } = useDesktopRuntime();
  const { create_barrier_checkpoint, wait_for_barrier } =
    useProjectPagesBarrier();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { t } = useI18n();
  const [selected_source, set_selected_source] =
    useState<SelectedSource | null>(null);
  const [selected_project, set_selected_project] =
    useState<SelectedProject | null>(null);
  const [is_source_checking, set_is_source_checking] = useState(false);
  const [is_preview_loading, set_is_preview_loading] = useState(false);
  const [is_creating_project, set_is_creating_project] = useState(false);
  const [is_opening_project, set_is_opening_project] = useState(false);
  const [active_dropzone, set_active_dropzone] = useState<ActiveDropzone>(null);
  const [missing_recent_project, set_missing_recent_project] =
    useState<MissingRecentProjectState>(null);
  const recent_projects = settings_snapshot.recent_projects.slice(0, 5);
  const has_recent_projects = recent_projects.length > 0;
  const create_footer_class_name =
    "project-home__footer mt-auto justify-center";
  const open_footer_class_name = "project-home__footer mt-auto justify-center";

  function clear_selected_project(): void {
    set_selected_project(null);
  }

  function clear_selected_source(): void {
    set_selected_source(null);
  }

  async function refresh_recent_projects(): Promise<void> {
    await refresh_settings();
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
      const payload = await api_fetch<ProjectPreviewPayload>(
        "/api/project/preview",
        { path: project_path },
      );
      set_selected_project(
        normalize_project_preview(project_path, fallback_name, payload),
      );
    } catch (error) {
      if (
        recent_project_name !== undefined &&
        error instanceof DesktopApiError &&
        error.code === "not_found"
      ) {
        set_missing_recent_project({
          path: project_path,
          name: fallback_name,
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
      const payload = await api_fetch<ProjectSourceFilesPayload>(
        "/api/project/source-files",
        { path: source_path },
      );
      const source_files = Array.isArray(payload.source_files)
        ? payload.source_files
        : [];

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
    if (result.canceled || result.path === null) {
      return;
    }

    await handle_select_source_path(result.path);
  }

  async function handle_select_source_folder(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceDirectoryPath();
    if (result.canceled || result.path === null) {
      return;
    }

    await handle_select_source_path(result.path);
  }

  async function handle_select_project_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectFilePath();
    if (result.canceled || result.path === null) {
      return;
    }

    await select_project_path(result.path);
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

  async function handle_source_drop(
    event: DragEvent<HTMLButtonElement>,
  ): Promise<void> {
    await handle_path_drop(event, handle_select_source_path);
  }

  async function handle_project_drop(
    event: DragEvent<HTMLButtonElement>,
  ): Promise<void> {
    await handle_path_drop(event, select_project_path);
  }

  async function resolve_project_output_path(
    source_path: string,
  ): Promise<string | null> {
    const default_file_name = build_default_project_file_name(source_path);
    const save_mode = settings_snapshot.project_save_mode;

    if (save_mode === "MANUAL") {
      const result =
        await window.desktopApp.pickProjectSavePath(default_file_name);
      return result.canceled ? null : result.path;
    }

    if (save_mode === "SOURCE") {
      const parent_dir = extract_parent_dir(source_path);
      return join_path(parent_dir, default_file_name);
    }

    let fixed_directory = settings_snapshot.project_fixed_path;
    if (fixed_directory === "") {
      const result = await window.desktopApp.pickFixedProjectDirectory();
      if (result.canceled || result.path === null) {
        return null;
      }

      fixed_directory = result.path;
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
      const output_path = await resolve_project_output_path(
        selected_source.path,
      );
      if (output_path === null || output_path === "") {
        return;
      }
      const normalized_output_path = output_path.endsWith(".lg")
        ? output_path
        : `${output_path}.lg`;
      const barrier_checkpoint = create_barrier_checkpoint();

      await run_modal_progress_toast({
        message: t("project_page.create.loading_toast"),
        task: async () => {
          const payload = await api_fetch<ProjectSnapshotPayload>(
            "/api/project/create",
            {
              source_path: selected_source.path,
              path: normalized_output_path,
            },
          );
          set_project_snapshot(normalize_project_snapshot(payload));
          await api_fetch<SettingsPayload>(
            "/api/settings/recent-projects/add",
            {
              path: normalized_output_path,
              name: extract_stem(extract_file_name(normalized_output_path)),
            },
          );
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
    if (
      selected_project === null ||
      selected_project.preview === null ||
      is_opening_project
    ) {
      return;
    }

    set_is_opening_project(true);

    try {
      const barrier_checkpoint = create_barrier_checkpoint();

      await run_modal_progress_toast({
        message: t("project_page.open.loading_toast"),
        task: async () => {
          const payload = await api_fetch<ProjectSnapshotPayload>(
            "/api/project/load",
            {
              path: selected_project.path,
            },
          );
          set_project_snapshot(normalize_project_snapshot(payload));
          await api_fetch<SettingsPayload>(
            "/api/settings/recent-projects/add",
            {
              path: selected_project.path,
              name: selected_project.name,
            },
          );
          await Promise.all([
            refresh_recent_projects(),
            refresh_task(),
            wait_for_barrier("project_warmup", {
              projectPath: selected_project.path,
              checkpoint: barrier_checkpoint,
            }),
          ]);
        },
      });
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

  async function handle_recent_project_remove(
    project_path: string,
  ): Promise<void> {
    try {
      await api_fetch<SettingsPayload>("/api/settings/recent-projects/remove", {
        path: project_path,
      });
      await refresh_recent_projects();
    } catch (error) {
      push_toast(
        "error",
        error instanceof Error
          ? error.message
          : t("project_page.open.remove_unavailable"),
      );
    }
  }

  const source_dropzone =
    selected_source === null ? (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <DropZoneCard
            icon="source"
            tone="blue"
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem
            onSelect={() => {
              void handle_select_source_file();
            }}
          >
            <File className="size-4" />
            {t("app.action.select_file")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void handle_select_source_folder();
            }}
          >
            <FolderOpen className="size-4" />
            {t("app.action.select_folder")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      <div
        className="project-home__selected-card project-home__selected-card--blue relative"
        data-drag-active={active_dropzone === "source" ? "true" : undefined}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="project-home__selected-close h-[30px] w-[30px] p-0"
          onClick={clear_selected_source}
          aria-label={t("app.action.reset")}
        >
          <X className="size-4" />
        </Button>

        <ContextMenu>
          <ContextMenuTrigger asChild>
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
              <div className="mx-auto flex w-full max-w-[288px] flex-col items-center space-y-0.5 text-center">
                <p className="w-full truncate text-[14.4px] tracking-[-0.02em] font-medium text-foreground">
                  {selected_source.name}
                </p>
                <p className="w-full text-[12.16px] text-[color:var(--project-home-subtitle)]">
                  {t("project_page.create.ready_status").replace(
                    "{COUNT}",
                    selected_source.source_file_count.toString(),
                  )}
                </p>
              </div>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <ContextMenuItem
              onSelect={() => {
                void handle_select_source_file();
              }}
            >
              <File className="size-4" />
              {t("app.action.select_file")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void handle_select_source_folder();
              }}
            >
              <FolderOpen className="size-4" />
              {t("app.action.select_folder")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );

  const open_dropzone =
    selected_project === null ? (
      <DropZoneCard
        icon="project"
        tone="purple"
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
        className="project-home__selected-card project-home__selected-card--purple relative"
        data-drag-active={active_dropzone === "project" ? "true" : undefined}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="project-home__selected-close h-[30px] w-[30px] p-0"
          onClick={clear_selected_project}
          aria-label={t("app.action.reset")}
        >
          <X className="size-4" />
        </Button>

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
          <div className="mx-auto flex w-full max-w-[288px] flex-col items-center space-y-0.5 text-center">
            <p className="w-full truncate text-[14.4px] tracking-[-0.02em] font-medium text-foreground">
              {extract_file_name(selected_project.path)}
            </p>
            <p className="w-full text-[12.16px] text-[color:var(--project-home-subtitle)]">
              {t("project_page.open.ready_status")}
            </p>
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
                void handle_recent_project_select(
                  project_item.path,
                  project_item.name,
                );
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
    missing_recent_project === null
      ? ""
      : t("project_page.open.missing_file_description").replace(
          "{PATH}",
          missing_recent_project.path,
        );

  return (
    <>
      <AppAlertDialog
        open={missing_recent_project !== null}
        title={t("project_page.open.missing_file_title")}
        description={missing_recent_project_description}
        descriptionClassName="whitespace-pre-line"
        onConfirm={() => {
          const target_path = missing_recent_project?.path;
          if (target_path === undefined) {
            return;
          }

          void (async () => {
            await api_fetch<SettingsPayload>(
              "/api/settings/recent-projects/remove",
              {
                path: target_path,
              },
            );
            await refresh_recent_projects();
            set_missing_recent_project(null);
          })();
        }}
        onClose={() => {
          set_missing_recent_project(null);
        }}
      />

      <div
        className="project-home page-shell page-shell--full"
        data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
      >
        <div className="project-home__layout grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          <Card variant="panel" className="project-home__panel">
            <PanelHeader
              accent_class_name="bg-[color:var(--project-home-blue)]"
              title={t("project_page.create.title")}
              subtitle={t("project_page.create.subtitle")}
            />

            <CardContent className="flex flex-1 flex-col gap-6">
              {source_dropzone}

              <section className="space-y-4 pt-4">
                <h3 className="text-[16px] leading-none tracking-[-0.02em] font-medium text-foreground">
                  {t("project_page.formats.title")}
                </h3>
                <div className="grid grid-cols-2 gap-2">
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

            <CardFooter className={create_footer_class_name}>
              <ProjectActionButton
                icon={File}
                label={t("project_page.create.action")}
                loading_label={t("app.action.loading")}
                is_loading={is_creating_project}
                disabled={
                  selected_source === null ||
                  is_source_checking ||
                  is_creating_project
                }
                on_click={() => {
                  void handle_create_project();
                }}
              />
            </CardFooter>
          </Card>

          <Card variant="panel" className="project-home__panel">
            <PanelHeader
              accent_class_name="bg-[color:var(--project-home-purple)]"
              title={t("project_page.open.title")}
              subtitle={t("project_page.open.subtitle")}
            />

            <CardContent className="flex flex-1 flex-col gap-6">
              {open_dropzone}

              <section className="space-y-4 pt-4">
                <h3 className="text-[16px] leading-none tracking-[-0.02em] font-medium text-foreground">
                  {t("project_page.open.recent_title")}
                </h3>

                <div>{recent_project_content}</div>
              </section>
            </CardContent>

            <CardFooter className={open_footer_class_name}>
              <ProjectActionButton
                icon={FolderOpen}
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
