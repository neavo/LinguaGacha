import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import type { AgentInputRequest } from "@frontend/app/navigation/types";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { extract_parent_dir } from "@frontend/app/desktop/path";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { format_local_timestamp } from "@shared/utils/format-local-timestamp";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import { save_project_language_preference } from "./project-language-preference";
import type { ProjectLoadPayload, RunProjectLoad } from "./use-project-load";

export type CreateEmptyProjectOptions = Readonly<{
  languages: ProjectLanguageSettings;
  anchor_paths?: readonly string[];
  agent_input_request?: AgentInputRequest;
}>;

const CREATE_PROJECT_PROGRESS_MS = 1_500; // 成功交接前留出统一的创建进度。

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
  const path_separator = directory_path.includes("\\") ? "\\" : "/";
  const normalized_directory = directory_path.replace(/[\\/]+$/u, "");
  return `${normalized_directory}${path_separator}${file_name}`;
}

/** 有来源时沿用源名称，空工程使用本地时间生成默认 `.lg` 文件名。 */
function build_default_project_file_name(project_name: string | undefined): string {
  if (project_name) return `${project_name}.lg`;
  const timestamp = format_local_timestamp(new Date().toISOString())!;
  return `lg_project_${timestamp.replace(/[-:]/gu, "").replace(" ", "_")}.lg`;
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

/** 默认名称沿用后端对素材路径的判断，失败时交由时间戳命名。 */
async function read_default_project_name(
  anchor_paths: readonly string[],
): Promise<string | undefined> {
  if (anchor_paths.length === 0) return undefined;
  try {
    const { project_name } = await api_fetch<{ project_name: string }>(
      "/api/session/project/default-name",
      { source_paths: anchor_paths },
    );
    return project_name;
  } catch {
    // 命名失败时继续使用时间戳，来源仍只作为保存目录锚点。
    return undefined;
  }
}

/** 侧栏与 Agent 发送共用空工程创建流程。 */
export function useProjectCreateFlow(run_project_load: RunProjectLoad) {
  const { settings_snapshot, refresh_settings } = useDesktopState();
  const { t } = useI18n();

  /**
   * 按保存模式解析新建工程输出路径，固定目录缺失时先请求用户选择。
   * 既没有来源也没有拖入路径时，源目录模式改为手动选择保存位置。
   */
  async function resolve_project_output_path(
    anchor_path: string | undefined,
    project_name: string | undefined,
  ): Promise<string | null> {
    const default_file_name = build_default_project_file_name(project_name);
    const save_mode = settings_snapshot.project_save_mode;

    if (save_mode === "SOURCE" && anchor_path !== undefined) {
      return join_path(extract_parent_dir(anchor_path), default_file_name);
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

  /** 只在工程已交接时返回 Store，取消和失败均由当前入口收尾。 */
  async function create_empty_project({
    languages,
    anchor_paths = [],
    agent_input_request,
  }: CreateEmptyProjectOptions): Promise<ProjectStore | null> {
    try {
      const project_name = await read_default_project_name(anchor_paths);
      const output_path = await resolve_project_output_path(anchor_paths[0], project_name);
      if (!output_path) return null;

      save_project_language_preference(languages);
      const project = await run_project_load({
        message: t("project.create.loading_toast"),
        minimum_progress_ms: CREATE_PROJECT_PROGRESS_MS,
        agent_input_request,
        request: () =>
          api_fetch<ProjectLoadPayload>("/api/session/project/create", {
            source_paths: [],
            path: output_path.toLowerCase().endsWith(".lg") ? output_path : `${output_path}.lg`,
            languages,
          }),
      });
      if (project === null) return null;

      const names = collect_loaded_default_preset_names(settings_snapshot, t);
      if (names.length > 0) {
        push_toast("info", t("project.create.default_preset_loaded", { NAMES: names.join(" | ") }));
      }
      return project;
    } catch (error) {
      push_error_toast(t("app.feedback.create_failed"), error);
      return null;
    }
  }

  return create_empty_project;
}
