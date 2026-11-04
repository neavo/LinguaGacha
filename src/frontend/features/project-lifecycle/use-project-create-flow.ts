import { useState } from "react";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { format_local_timestamp } from "@shared/utils/format-local-timestamp";
import type { ProjectLanguageKey } from "@domain/project-settings";
import {
  read_project_language_preference,
  save_project_language_preference,
} from "./project-language-preference";
import type { RunProjectLoad } from "./use-project-load";

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
  const path_separator = directory_path.includes("\\") ? "\\" : "/";
  const normalized_directory = directory_path.replace(/[\\/]+$/u, "");
  return `${normalized_directory}${path_separator}${file_name}`;
}

/** 空工程没有来源名称，使用本地时间生成默认 `.lg` 文件名。 */
function build_default_project_file_name(): string {
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

/** 创建意图随应用会话常驻，工程加载导致页面卸载后仍能完成收尾。 */
export function useProjectCreateFlow(run_project_load: RunProjectLoad) {
  const { settings_snapshot, refresh_settings } = useDesktopState();
  const { navigate_to_agent } = useAppNavigation();

  const { t } = useI18n();
  const [is_creating_project, set_is_creating_project] = useState(false);
  const [is_language_dialog_open, set_is_language_dialog_open] = useState(false);
  // 新建语言草稿由创建流程持有，取消或创建失败后保留本次选择。
  const [create_languages, set_create_languages] = useState<ProjectLanguageDraft>(
    read_project_language_preference,
  );
  const [open, set_open] = useState(false);

  /**
   * 按保存模式解析新建工程输出路径，固定目录缺失时先请求用户选择。
   * 空工程没有来源目录，源目录模式与手动模式一样选择保存位置。
   */
  async function resolve_project_output_path(): Promise<string | null> {
    const default_file_name = build_default_project_file_name();
    if (settings_snapshot.project_save_mode !== "FIXED") {
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

  /** 倒计时结束后进入语言确认，确认后才选择保存路径并创建。 */
  function open_language_dialog(): void {
    if (!is_creating_project) set_is_language_dialog_open(true);
  }

  /** 确认即保存偏好，再使用同一份语言快照创建工程。 */
  function confirm_language_dialog(): void {
    const languages = { ...create_languages }; // 路径选择期间固定本次提交值。
    save_project_language_preference(languages);
    set_is_language_dialog_open(false);
    void handle_create_project(languages);
  }

  /** 提交新建空工程请求，成功后提示并在 AGENT 中预置添加文件草稿。 */
  async function handle_create_project(languages: ProjectLanguageDraft): Promise<void> {
    if (is_creating_project) {
      return;
    }

    set_is_creating_project(true);

    try {
      const loaded_default_preset_names = collect_loaded_default_preset_names(settings_snapshot, t);
      const output_path = await resolve_project_output_path();
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
            { path: normalized_output_path, languages },
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
      push_toast("success", t("project.create.success"));
      if (loaded_default_preset_names.length > 0) {
        push_toast(
          "info",
          t("project.create.default_preset_loaded").replace(
            "{NAMES}",
            loaded_default_preset_names.join(" | "),
          ),
        );
      }
      // 选中占位行，让输入或拖入文件直接替换它。
      const prompt = t("project.create.add_files_draft.prompt");
      const text = `${prompt}\n${t("project.create.add_files_draft.placeholder")}`;
      navigate_to_agent({ text, selection: { from: prompt.length + 1, to: text.length } });
    } catch (error) {
      push_error_toast(t("app.feedback.create_failed"), error);
    } finally {
      set_is_creating_project(false);
    }
  }

  return {
    open,
    show: () => set_open(true),
    close: () => set_open(false),
    is_creating_project,
    is_language_dialog_open,
    create_languages,
    set_create_languages,
    set_is_language_dialog_open,
    open_language_dialog,
    confirm_language_dialog,
  };
}
