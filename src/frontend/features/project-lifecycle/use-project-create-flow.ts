import { useState } from "react";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { extract_file_name, extract_parent_dir } from "@frontend/app/desktop/path";
import { normalize_source_paths } from "@frontend/app/desktop/source-paths";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useGodotPackOrder } from "@frontend/features/godot-pack-order/use-godot-pack-order";
import { useGameBackupConfirm } from "@frontend/features/game-backup-confirm/use-game-backup-confirm";
import { GODOT_PACK_ORDER_REFRESH_ACTION } from "@shared/godot";
import { format_local_timestamp } from "@shared/utils/format-local-timestamp";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatHitCounts,
  type ProjectSourceFileSummary,
} from "@shared/project-source-formats";
import type { ProjectLanguageKey } from "@domain/project-settings";
import type { PathDropIssue } from "@frontend/widgets/file-drop-zone/use-path-drop";
import {
  read_project_language_preference,
  save_project_language_preference,
} from "./project-language-preference";
import type { RunProjectLoad } from "./use-project-load";
/** 已选择的源路径与后端摘要，首个路径用于推导默认工程名。 */
type SelectedSource = ProjectSourceFileSummary & {
  source_paths: string[]; // 创建工程时原样提交的归一化用户选择
};

/** 新建工程提交后的公开载荷。 */
type ProjectCreateCommitPayload = {
  project?: {
    path?: string;
  };
};

type ProjectLanguageDraft = Record<ProjectLanguageKey, string>;

/** 新建成功后只提示这组默认预设。 */
const DEFAULT_PRESET_SETTING_SPECS = [
  {
    settings_key: "glossary_default_preset",
    name_key: "project.create.default_presets.glossary",
  },
  {
    settings_key: "text_preserve_default_preset",
    name_key: "project.create.default_presets.text_preserve",
  },
  {
    settings_key: "pre_translation_replacement_default_preset",
    name_key: "project.create.default_presets.pre_translation_replacement",
  },
  {
    settings_key: "post_translation_replacement_default_preset",
    name_key: "project.create.default_presets.post_translation_replacement",
  },
  {
    settings_key: "translation_custom_prompt_default_preset",
    name_key: "project.create.default_presets.translation_prompt",
  },
] as const satisfies readonly { settings_key: keyof SettingsSnapshot; name_key: LocaleKey }[];

/** 拼接路径片段并沿用输入目录的分隔符风格。 */
function join_path(directory_path: string, file_name: string): string {
  if (directory_path === "") {
    return file_name;
  }

  const path_separator = directory_path.includes("\\") ? "\\" : "/";
  const normalized_directory = directory_path.replace(/[\\/]+$/u, "");
  return `${normalized_directory}${path_separator}${file_name}`;
}

/** 有来源时沿用源名称，空工程使用本地时间生成默认 `.lg` 文件名。 */
function build_default_project_file_name(source_path: string | undefined): string {
  if (source_path === undefined) {
    const timestamp = format_local_timestamp(new Date().toISOString())!;
    return `lg_project_${timestamp.replace(/[-:]/gu, "").replace(" ", "_")}.lg`;
  }
  const file_name = extract_file_name(source_path);
  const has_extension = file_name.lastIndexOf(".") > 0;
  const base_name = has_extension ? file_name.replace(/\.[^.]+$/u, "") : file_name;
  return `${base_name}.lg`;
}

/** 源文件格式命中数归一为非负整数，供格式标签展示。 */
function normalize_count(value: unknown): number {
  const numeric_value = Number(value ?? 0);
  if (!Number.isFinite(numeric_value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric_value));
}

/** API 边界按共享目录补齐全部格式计数，缺失或无效值归零。 */
function normalize_project_source_format_hit_counts(value: unknown): ProjectSourceFormatHitCounts {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    PROJECT_SOURCE_FORMATS.map((format) => [format.id, normalize_count(record[format.id])]),
  ) as ProjectSourceFormatHitCounts;
}

/** 收集非空默认预设名称，用于新建成功后的信息提示。 */
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

/** 创建意图随应用会话常驻，工程加载导致页面卸载后仍能完成收尾。 */
export function useProjectCreateFlow(run_project_load: RunProjectLoad) {
  const { settings_snapshot, refresh_settings } = useDesktopState();

  const { t } = useI18n();
  const pack_order = useGodotPackOrder();
  const backup_confirm = useGameBackupConfirm();
  const [selected_source, set_selected_source] = useState<SelectedSource | null>(null);
  const [is_source_checking, set_is_source_checking] = useState(false);
  const [is_creating_project, set_is_creating_project] = useState(false);
  const [is_language_dialog_open, set_is_language_dialog_open] = useState(false);
  // 新建语言草稿由创建流程持有，取消或创建失败后保留本次选择。
  const [create_languages, set_create_languages] = useState<ProjectLanguageDraft>(
    read_project_language_preference,
  );
  const [open, set_open] = useState(false);
  const source_selection_disabled = is_source_checking || is_creating_project; // 摘要与创建共用来源快照，期间冻结所有编辑入口。

  /** 清空本次创建的来源选择。 */
  function clear_selected_source(): void {
    set_selected_source(null);
  }

  /** 选择一个或多个源路径后，让后端按支持格式收集真实导入文件。 */
  async function handle_select_source_paths(source_paths: string[]): Promise<void> {
    const normalized_source_paths = normalize_source_paths(source_paths);
    if (normalized_source_paths.length === 0) {
      set_selected_source(null);
      push_toast("warning", t("project.create.unavailable"));
      return;
    }

    set_is_source_checking(true);

    try {
      const payload = await api_fetch<Partial<ProjectSourceFileSummary>>(
        "/api/session/source-files/summary",
        {
          source_paths: normalized_source_paths,
        },
      );
      const source_file_count = normalize_count(payload.source_file_count);

      if (source_file_count === 0) {
        set_selected_source(null);
        push_toast("warning", t("project.create.unavailable"));
      } else {
        set_selected_source({
          source_paths: normalized_source_paths,
          godot_packs: payload.godot_packs ?? [],
          contains_game: payload.contains_game === true,
          source_file_count,
          format_hit_counts: normalize_project_source_format_hit_counts(payload.format_hit_counts),
        });
      }
    } catch {
      set_selected_source(null);
      push_toast("warning", t("project.create.unavailable"));
    } finally {
      set_is_source_checking(false);
    }
  }

  /** 打开系统文件选择器，保留多选结果的完整路径集合。 */
  async function handle_select_source_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceFilePath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_paths(result.paths);
  }

  /** 打开系统目录选择器，目录模式只返回单个根路径。 */
  async function handle_select_source_folder(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceDirectoryPath();
    const selected_path = result.paths[0] ?? null;
    if (result.canceled || selected_path === null) {
      return;
    }

    await handle_select_source_paths([selected_path]);
  }

  /**
   * 按保存模式解析新建工程输出路径，固定目录缺失时先请求用户选择。
   * 空工程没有来源目录，源目录模式改为手动选择保存位置。
   */
  async function resolve_project_output_path(
    source_path: string | undefined,
  ): Promise<string | null> {
    const default_file_name = build_default_project_file_name(source_path);
    const save_mode = settings_snapshot.project_save_mode;

    if (save_mode === "SOURCE" && source_path !== undefined) {
      return join_path(extract_parent_dir(source_path), default_file_name);
    }

    if (save_mode === "MANUAL" || save_mode === "SOURCE") {
      const result = await window.desktopApp.pickProjectSavePath(default_file_name);
      return result.canceled ? null : (result.paths[0] ?? null);
    }

    let fixed_directory = settings_snapshot.project_fixed_path;
    if (fixed_directory === "") {
      const result = await window.desktopApp.pickDirectory();
      const selected_path = result.paths[0] ?? null;
      if (result.canceled || selected_path === null) {
        return null;
      }

      fixed_directory = selected_path;
      await api_fetch("/api/settings/update", {
        project_fixed_path: fixed_directory,
      });
      await refresh_settings();
    }

    return join_path(fixed_directory, default_file_name);
  }

  /**
   * 点击创建先提示备份原生游戏，再选择项目语言，确认后才进入保存路径与创建流程。
   * 未选择来源时创建空工程。
   */
  async function open_language_dialog(): Promise<void> {
    if (source_selection_disabled) {
      return;
    }
    if (!(await backup_confirm.request_confirm(selected_source?.contains_game === true))) return;

    set_is_language_dialog_open(true);
  }

  /** 确认即保存偏好，再使用同一份语言快照创建工程。 */
  function confirm_language_dialog(): void {
    const languages = { ...create_languages }; // 路径选择期间固定本次提交值。
    save_project_language_preference(languages);
    set_is_language_dialog_open(false);
    void handle_create_project(languages);
  }

  /** 提交新建工程请求，成功后刷新会话、任务和最近工程。 */
  async function handle_create_project(languages: ProjectLanguageDraft): Promise<void> {
    if (source_selection_disabled) {
      return;
    }

    set_is_creating_project(true);

    try {
      const loaded_default_preset_names = collect_loaded_default_preset_names(settings_snapshot, t);
      const source_paths = selected_source?.source_paths ?? [];
      const godot_pack_orders = await pack_order.request_order(selected_source?.godot_packs);
      if (godot_pack_orders === null) return;
      const output_path = await resolve_project_output_path(source_paths[0]); // 首项决定默认名称和目录。
      if (output_path === null || output_path === "") {
        return;
      }
      const normalized_output_path = output_path.endsWith(".lg")
        ? output_path
        : `${output_path}.lg`;
      await run_project_load({
        message: t("project.create.loading_toast"),
        request: async () => {
          const create_payload = await api_fetch<ProjectCreateCommitPayload>(
            "/api/session/project/create",
            {
              source_paths,
              ...(godot_pack_orders.length ? { godot_pack_orders } : {}),
              path: normalized_output_path,
              languages,
            },
          );
          const created_project_path =
            typeof create_payload.project?.path === "string" &&
            create_payload.project.path.trim() !== ""
              ? create_payload.project.path
              : normalized_output_path;
          return created_project_path;
        },
      });
      set_open(false);
      if (loaded_default_preset_names.length > 0) {
        push_toast(
          "info",
          t("project.create.default_preset_loaded").replace(
            "{NAMES}",
            loaded_default_preset_names.join(" | "),
          ),
        );
      }
      clear_selected_source();
    } catch (error) {
      if (
        selected_source !== null &&
        error instanceof DesktopApiError &&
        error.details.action === GODOT_PACK_ORDER_REFRESH_ACTION
      ) {
        await handle_select_source_paths(selected_source.source_paths);
      }

      push_error_toast(t("app.feedback.create_failed"), error);
    } finally {
      set_is_creating_project(false);
    }
  }

  /** 拖入问题保留当前选择，只提示改用点击选择。 */
  function handle_drop_issue(issue: PathDropIssue): void {
    push_toast(
      "warning",
      t(
        issue === "multiple"
          ? "app.drop.select_multiple_unavailable"
          : "app.drop.select_unavailable",
      ),
    );
  }

  return {
    open,
    show: () => {
      clear_selected_source();
      set_open(true);
    },
    close: () => set_open(false),
    selected_source,
    source_selection_disabled,
    is_language_dialog_open,
    create_languages,
    set_create_languages,
    set_is_language_dialog_open,
    pack_order,
    backup_confirm,
    clear_selected_source,
    handle_select_source_file,
    handle_select_source_folder,
    handle_select_source_paths,
    handle_drop_issue,
    open_language_dialog,
    confirm_language_dialog,
  };
}
