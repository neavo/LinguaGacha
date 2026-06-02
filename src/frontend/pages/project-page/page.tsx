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

import { type SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { AppButton } from "@frontend/widgets/app-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@frontend/shadcn/card";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@frontend/widgets/app-context-menu";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { type LocaleKey, useI18n } from "@frontend/app/locale/locale-provider";
import { has_path_drop_payload, resolve_dropped_path } from "@frontend/app/desktop/file-drop-paths";
import { normalize_source_paths } from "@frontend/app/desktop/source-paths";
import {
  format_source_file_parse_failure_error_toast,
  format_source_file_parse_failure_toast,
} from "@frontend/app/feedback/source-file-parse-failure-feedback";
import { cn } from "@frontend/styling/classnames";
import {
  SegmentedProgress,
  type SegmentedProgressStats,
} from "@frontend/widgets/segmented-progress/segmented-progress";
import "@frontend/pages/project-page/project-page.css";
import { PROJECT_FORMAT_SUPPORT_ITEMS } from "@frontend/pages/project-page/support-formats";
import { DesktopApiError, api_fetch } from "@frontend/app/desktop/desktop-api";
import { type ProjectStage } from "@frontend/app/state/desktop-project-change-types";
import {
  format_project_settings_aligned_toast,
  type ProjectSettingsAlignmentChangedFields,
  type ProjectSettingsAlignmentSettings,
} from "@frontend/app/feedback/project-settings-alignment-feedback";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";

/**
 * 项目页只消费侧栏折叠状态，主体数据来自 DesktopState。
 */
type ProjectPageProps = {
  is_sidebar_collapsed: boolean;
};

/**
 * 工程预览展示所需的轻量统计快照。
 */
type ProjectPreviewStats = {
  file_count: number;
  created_at: string;
  last_updated_at: string;
  progress_percent: number;
  translation_stats: SegmentedProgressStats;
};

/**
 * 已选择的 .lg 工程及其可选预览结果。
 */
type SelectedProject = {
  path: string;
  name: string;
  preview: ProjectPreviewStats | null;
};

/**
 * 已选择的源路径集合，保留首个路径用于推导默认工程名。
 */
type SelectedSource = {
  source_paths: string[];
  name: string;
  source_file_count: number;
  output_name_seed_path: string;
};

/**
 * 最近工程缺失时弹窗只需要记住待移除路径。
 */
type MissingRecentProjectState = {
  path: string;
} | null;

/**
 * 后端工程预览接口返回的宽松载荷，页面在边界处归一。
 */
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

/**
 * 源路径收集接口返回的可导入文件列表。
 */
type ProjectSourceFilesPayload = {
  source_files?: string[];
};

/**
 * 新建工程提交后的公开载荷，failed_files 交给专用 formatter 收窄。
 */
type ProjectCreateCommitPayload = {
  project?: {
    path?: string;
  };
  failed_files?: unknown;
};

/**
 * 打开工程前 settings alignment 预演结果。
 */
type ProjectOpenAlignmentPreviewPayload = {
  preview?: {
    action?: string;
    section_revisions?: Record<string, unknown> | null;
    changed?: ProjectSettingsAlignmentChangedFields;
  };
};

/**
 * 默认预设设置字段白名单，控制新建成功后的提示内容。
 */
type DefaultPresetSettingKey =
  | "glossary_default_preset"
  | "text_preserve_default_preset"
  | "pre_translation_replacement_default_preset"
  | "post_translation_replacement_default_preset"
  | "translation_custom_prompt_default_preset"
  | "analysis_custom_prompt_default_preset";

/**
 * 设置字段到本地化名称的映射，用于汇总已加载默认预设。
 */
type DefaultPresetSettingSpec = {
  settings_key: DefaultPresetSettingKey;
  name_key: LocaleKey;
};

/**
 * settings 接口在项目页会消费的最小响应形状。
 */
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

/**
 * 创建和打开两个主面板的标题区配置。
 */
type PanelHeaderProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tone: "source" | "project";
};

/**
 * 源文件和工程文件拖放区的统一按钮 props。
 */
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

/**
 * 支持格式卡片只展示格式名和扩展名集合。
 */
type FormatSupportCardProps = {
  title: string;
  extensions: string;
};

/**
 * 最近工程列表行的展示文本和操作回调。
 */
type RecentProjectRowProps = {
  name: string;
  path: string;
  on_select: () => void;
  on_remove: () => void;
  remove_aria_label: string;
};

/**
 * 工程预览面板只依赖已归一的 selected project。
 */
type ProjectPreviewPanelProps = {
  project: SelectedProject;
};

/**
 * 底部主操作按钮在加载态和可用态之间切换图标与文案。
 */
type ProjectActionButtonProps = {
  icon: LucideIcon;
  label: string;
  loading_label: string;
  is_loading: boolean;
  disabled: boolean;
  on_click: () => void;
};

/**
 * 当前正在接收拖拽反馈的区域。
 */
type ActiveDropzone = "source" | "project" | null;

/**
 * 新建成功后需要提示的默认预设字段集合。
 */
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

/**
 * 从跨平台路径中提取文件名，供默认工程名和最近工程名复用。
 */
function extract_file_name(file_path: string): string {
  const normalized_segments = file_path.split(/[\\/]+/u);
  return normalized_segments.at(-1) ?? file_path;
}

/**
 * 从文件名中提取 stem，避免默认工程名继承源文件扩展名。
 */
function extract_stem(file_name: string): string {
  return file_name.replace(/\.[^.]+$/u, "");
}

/**
 * 提取父目录，SOURCE 保存模式使用源文件所在目录。
 */
function extract_parent_dir(file_path: string): string {
  const normalized_index = Math.max(file_path.lastIndexOf("/"), file_path.lastIndexOf("\\"));
  if (normalized_index <= 0) {
    return "";
  }

  return file_path.slice(0, normalized_index);
}

/**
 * 拼接路径片段并沿用输入目录的分隔符风格。
 */
function join_path(directory_path: string, file_name: string): string {
  if (directory_path === "") {
    return file_name;
  }

  const path_separator = directory_path.includes("\\") ? "\\" : "/";
  const normalized_directory = directory_path.replace(/[\\/]+$/u, "");
  return `${normalized_directory}${path_separator}${file_name}`;
}

/**
 * 按源路径生成默认 .lg 文件名，目录输入也能得到稳定名称。
 */
function build_default_project_file_name(source_path: string): string {
  const file_name = extract_file_name(source_path);
  const has_extension = file_name.lastIndexOf(".") > 0;
  const base_name = has_extension ? extract_stem(file_name) : file_name;
  return `${base_name}.lg`;
}

/**
 * 格式化错误提示，有可见错误详情时填充模板占位。
 */
function format_project_error_message(args: {
  template: string;
  generic_text: string;
  error: unknown;
  t: ReturnType<typeof useI18n>["t"];
}): string {
  const error_detail = resolve_visible_error_message(args.error, args.t, "").trim();

  if (error_detail === "") {
    return args.generic_text;
  } else {
    return args.template.replace("{ERROR}", error_detail);
  }
}

/**
 * 给统计文案追加单位，空单位时保持原文案。
 */
function append_optional_unit_label(text: string, unit_label: string): string {
  if (unit_label === "") {
    return text;
  } else {
    return `${text} ${unit_label}`;
  }
}

/**
 * 计数字段统一归一为非负整数，保护预览 UI 不显示 NaN。
 */
function normalize_count(value: unknown): number {
  const numeric_value = Number(value ?? 0);
  if (!Number.isFinite(numeric_value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric_value));
}

/**
 * 百分比字段固定在 0 到 100，保护进度条输入边界。
 */
function normalize_percent(value: unknown): number {
  const numeric_value = Number(value ?? 0);
  if (!Number.isFinite(numeric_value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numeric_value));
}

/**
 * 提取 settings alignment 需要的项目镜像字段。
 */
function build_project_prefilter_settings(
  settings_snapshot: SettingsSnapshot,
): ProjectSettingsAlignmentSettings {
  return {
    source_language: settings_snapshot.source_language,
    target_language: settings_snapshot.target_language,
    mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings_snapshot.skip_duplicate_source_text_enable,
  };
}

/**
 * 收集非空默认预设名称，用于新建成功后的信息提示。
 */
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

/**
 * 归一工程预览统计，并在旧项目缺 completion_percent 时现场补算。
 */
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

/**
 * 将后端预览宽载荷收窄为页面选择态。
 */
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

/**
 * 右键菜单入口复用普通点击，保持拖放卡片仍是单个可聚焦按钮。
 */
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

/**
 * 渲染创建/打开面板标题，tone 只影响局部标记色。
 */
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

/**
 * 统一源文件和工程文件拖放入口，forwardRef 供 context menu trigger 挂载。
 */
const DropZoneCard = forwardRef<HTMLButtonElement, DropZoneCardProps>(
  /**
   * 渲染可点击可拖放的主入口按钮。
   */
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
    const Icon = icon === "source" ? FilePlus : FileInput; // 创建与打开入口保留不同图标语义。

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

/**
 * 展示单个支持格式条目。
 */
function FormatSupportCard(props: FormatSupportCardProps): JSX.Element {
  return (
    <div className="project-home__format-item">
      <h3 className="project-home__format-title">{props.title}</h3>
      <p className="project-home__format-extensions">{props.extensions}</p>
    </div>
  );
}

/**
 * 最近工程行同时承载选择和移除操作，移除按钮阻止冒泡。
 */
function RecentProjectRow(props: RecentProjectRowProps): JSX.Element {
  /**
   * 移除最近工程时不触发行选择。
   */
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

/**
 * 最近工程为空时显示紧凑占位。
 */
function RecentProjectEmptyState(): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="project-home__recent-empty">
      <BadgeAlert className="project-home__recent-empty-icon size-16 stroke-[1.9]" />
      <p className="project-home__recent-empty-text">{t("project_page.open.empty")}</p>
    </div>
  );
}

/**
 * 工程预览面板展示摘要字段和四段翻译进度。
 */
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

/**
 * 创建和打开两个主操作共享的加载态按钮。
 */
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

/**
 * 将项目加载阶段映射为模态进度文案。
 */
function resolve_project_loading_stage_message(
  stage: ProjectStage | null,
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

/**
 * 等待下一帧，给加载 Toast 的最后一次阶段更新留出渲染机会。
 */
function wait_for_next_animation_frame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * 项目页是工程创建、打开和最近工程恢复的唯一入口，成功后交给 DesktopState 初始化会话。
 */
export function ProjectPage(_props: ProjectPageProps): JSX.Element {
  const {
    project_session_stage,
    settings_snapshot,
    set_project_session_status,
    refresh_project_snapshot,
    refresh_settings,
    refresh_task,
  } = useDesktopState();
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
  const recent_projects = settings_snapshot.recent_projects.slice(0, 5);
  const has_recent_projects = recent_projects.length > 0;

  /**
   * 清空打开工程选择，保留源文件选择。
   */
  function clear_selected_project(): void {
    set_selected_project(null);
  }

  /**
   * 清空新建工程源文件选择，保留打开工程选择。
   */
  function clear_selected_source(): void {
    set_selected_source(null);
  }

  /**
   * 刷新最近工程列表，数据来源仍是 settings 快照。
   */
  async function refresh_recent_projects(): Promise<void> {
    await refresh_settings();
  }

  useEffect(() => {
    const toast_id = project_loading_toast_id_ref.current;
    const next_message = resolve_project_loading_stage_message(project_session_stage, t);
    const normalized_message = next_message?.trim() ?? "";

    if (toast_id === null || normalized_message === "") {
      return;
    }

    update_progress_toast(toast_id, {
      message: normalized_message,
      presentation: "modal",
    });
  }, [project_session_stage, t, update_progress_toast]);

  /**
   * 包裹创建、打开和预览流程，统一展示可更新的模态进度。
   */
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

  /**
   * 选择工程路径并读取预览，最近工程缺失时转入移除确认。
   */
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
      await run_project_loading_modal({
        initial_message: t("project_page.open.preview_loading_toast"),
        task: async () => {
          const payload = await api_fetch<ProjectPreviewPayload>("/api/session/project/preview", {
            path: project_path,
          });
          set_selected_project(normalize_project_preview(project_path, fallback_name, payload));
        },
      });
    } catch (error) {
      if (
        recent_project_name !== undefined &&
        error instanceof DesktopApiError &&
        error.code === "project.not_found"
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
            t,
          }),
        );
      }

      set_selected_project(null);
    } finally {
      set_is_preview_loading(false);
    }
  }

  /**
   * 选择一个或多个源路径后，让后端按支持格式收集真实导入文件。
   */
  async function handle_select_source_paths(source_paths: string[]): Promise<void> {
    const normalized_source_paths = normalize_source_paths(source_paths);
    if (normalized_source_paths.length === 0) {
      set_selected_source(null);
      push_toast("warning", t("project_page.create.unavailable"));
      return;
    }

    set_is_source_checking(true);

    try {
      const payload = await api_fetch<ProjectSourceFilesPayload>(
        "/api/session/source-files/collect",
        {
          source_paths: normalized_source_paths,
        },
      );
      const source_files = Array.isArray(payload.source_files) ? payload.source_files : [];

      if (source_files.length === 0) {
        set_selected_source(null);
        push_toast("warning", t("project_page.create.unavailable"));
      } else {
        const output_name_seed_path = normalized_source_paths[0] ?? "";
        const selected_name = t("project_page.create.ready_status").replace(
          "{COUNT}",
          source_files.length.toString(),
        );
        set_selected_source({
          source_paths: normalized_source_paths,
          name: selected_name,
          source_file_count: source_files.length,
          output_name_seed_path,
        });
      }
    } catch {
      set_selected_source(null);
      push_toast("warning", t("project_page.create.unavailable"));
    } finally {
      set_is_source_checking(false);
    }
  }

  /**
   * 单路径入口复用多路径选择流程。
   */
  async function handle_select_source_path(source_path: string): Promise<void> {
    await handle_select_source_paths([source_path]);
  }

  /**
   * 打开系统文件选择器，保留多选结果的完整路径集合。
   */
  async function handle_select_source_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceFilePath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_paths(result.paths);
  }

  /**
   * 打开系统目录选择器，目录模式只返回单个根路径。
   */
  async function handle_select_source_folder(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceDirectoryPath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_path(selected_path);
  }

  /**
   * 打开系统工程文件选择器并进入预览流程。
   */
  async function handle_select_project_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectFilePath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await select_project_path(selected_path);
  }

  /**
   * 拖拽悬停时只接受可解析路径，避免浏览器默认 drop 行为污染页面。
   */
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

  /**
   * 拖拽离开当前区域时清理激活态。
   */
  function handle_drop_leave(dropzone: Exclude<ActiveDropzone, null>): void {
    set_active_dropzone((current_dropzone) => {
      if (current_dropzone === dropzone) {
        return null;
      } else {
        return current_dropzone;
      }
    });
  }

  /**
   * 解析 drop 事件中的宿主路径，并把多路径与空路径转成可见提示。
   */
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

  /**
   * 源文件拖放进入新建工程选择流程。
   */
  async function handle_source_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    await handle_path_drop(event, handle_select_source_path);
  }

  /**
   * 工程文件拖放进入打开工程预览流程。
   */
  async function handle_project_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    await handle_path_drop(event, select_project_path);
  }

  /**
   * 按保存模式解析新建工程输出路径，固定目录缺失时先请求用户选择。
   */
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

  /**
   * 提交新建工程请求，成功后刷新会话、任务和最近工程。
   */
  async function handle_create_project(): Promise<void> {
    if (selected_source === null || is_creating_project) {
      return;
    }

    set_is_creating_project(true);

    try {
      const loaded_default_preset_names = collect_loaded_default_preset_names(settings_snapshot, t);
      const source_path = selected_source.output_name_seed_path;
      const source_paths = selected_source.source_paths;
      const output_path = await resolve_project_output_path(source_path);
      if (output_path === null || output_path === "") {
        return;
      }
      const normalized_output_path = output_path.endsWith(".lg")
        ? output_path
        : `${output_path}.lg`;
      await run_project_loading_modal({
        initial_message: t("project_page.create.loading_toast"),
        task: async () => {
          const create_payload = await api_fetch<ProjectCreateCommitPayload>(
            "/api/session/project/create",
            {
              source_paths,
              path: normalized_output_path,
              project_settings: build_project_prefilter_settings(settings_snapshot),
            },
          );
          const failure_toast = format_source_file_parse_failure_toast({
            value: create_payload.failed_files,
            text: t,
          });
          if (failure_toast !== null) {
            push_toast("warning", failure_toast);
          }
          const created_project_path =
            typeof create_payload.project?.path === "string" &&
            create_payload.project.path.trim() !== ""
              ? create_payload.project.path
              : normalized_output_path;
          set_project_session_status("warming");
          await refresh_project_snapshot();
          await api_fetch<SettingsPayload>("/api/settings/recent-projects/add", {
            path: created_project_path,
            name: extract_stem(extract_file_name(created_project_path)),
          });
          await Promise.all([refresh_recent_projects(), refresh_task()]);
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
      const parse_failure_toast = format_source_file_parse_failure_error_toast({ error, text: t });
      if (parse_failure_toast !== null) {
        push_toast("error", parse_failure_toast);
        return;
      }
      push_toast(
        "error",
        format_project_error_message({
          template: t("project_page.create.failed"),
          generic_text: t("project_page.create.failed_generic"),
          error,
          t,
        }),
      );
      return;
    } finally {
      set_is_creating_project(false);
    }
  }

  /**
   * 打开既有工程前先执行设置对齐预演，再加载后端会话。
   */
  async function handle_open_project(): Promise<void> {
    if (selected_project === null || selected_project.preview === null || is_opening_project) {
      return;
    }

    set_is_opening_project(true);

    try {
      const project_to_open = selected_project;
      let did_align_project_settings = false;
      let aligned_changed_fields: ProjectSettingsAlignmentChangedFields = {};

      await run_project_loading_modal({
        initial_message: t("project_page.open.loading_toast"),
        task: async () => {
          const alignment_payload = await api_fetch<ProjectOpenAlignmentPreviewPayload>(
            "/api/session/project/open-preview",
            {
              path: project_to_open.path,
            },
          );
          const alignment_preview = alignment_payload.preview ?? {};
          const alignment_action = String(alignment_preview.action ?? "load");
          const alignment_settings = build_project_prefilter_settings(settings_snapshot);
          const alignment_changed_fields = alignment_preview.changed ?? {};

          if (alignment_action === "settings_only") {
            await api_fetch("/api/workbench/settings-alignment/apply", {
              path: project_to_open.path,
              mode: "settings_only",
              project_settings: alignment_settings,
            });
            did_align_project_settings = true;
            aligned_changed_fields = alignment_changed_fields;
          } else if (alignment_action === "prefiltered_items") {
            const section_revisions = alignment_preview.section_revisions ?? {};
            await api_fetch("/api/workbench/settings-alignment/apply", {
              path: project_to_open.path,
              mode: "prefiltered_items",
              project_settings: alignment_settings,
              expected_section_revisions: {
                items: Number(section_revisions.items ?? 0),
                analysis: Number(section_revisions.analysis ?? 0),
              },
            });
            did_align_project_settings = true;
            aligned_changed_fields = alignment_changed_fields;
          }

          await api_fetch("/api/session/project/open", {
            path: project_to_open.path,
          });
          set_project_session_status("warming");
          await refresh_project_snapshot();
          await api_fetch<SettingsPayload>("/api/settings/recent-projects/add", {
            path: project_to_open.path,
            name: project_to_open.name,
          });
          await Promise.all([refresh_recent_projects(), refresh_task()]);
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
          t,
        }),
      );
      return;
    } finally {
      set_is_opening_project(false);
    }
  }

  /**
   * 最近工程点击复用普通工程路径预览，并携带展示名。
   */
  async function handle_recent_project_select(
    project_path: string,
    project_name: string,
  ): Promise<void> {
    await select_project_path(project_path, project_name);
  }

  /**
   * 从最近工程列表移除路径后刷新 settings 快照。
   */
  async function handle_recent_project_remove(project_path: string): Promise<void> {
    try {
      await api_fetch<SettingsPayload>("/api/settings/recent-projects/remove", {
        path: project_path,
      });
      await refresh_recent_projects();
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("project_page.open.remove_unavailable")),
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
