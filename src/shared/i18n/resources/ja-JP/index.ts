import { ja_jp_agent_page } from "./agent-page";
import { ja_jp_agent_runtime } from "./agent-runtime";
import { ja_jp_app } from "./app";
import { ja_jp_basic_settings_page } from "./basic-settings-page";
import { ja_jp_batch_translation } from "./batch-translation";
import { ja_jp_custom_prompt_page } from "./custom-prompt-page";
import { ja_jp_expert_settings_page } from "./expert-settings-page";
import { ja_jp_glossary_page } from "./glossary-page";
import { ja_jp_laboratory_page } from "./laboratory-page";
import { ja_jp_log_window_page } from "./log-window-page";
import { ja_jp_model_page } from "./model-page";
import { ja_jp_post_translation_replacement_page } from "./post-translation-replacement-page";
import { ja_jp_pre_translation_replacement_page } from "./pre-translation-replacement-page";
import { ja_jp_preset_editor } from "./preset-editor";
import { ja_jp_project_page } from "./project-page";
import { ja_jp_proofreading_page } from "./proofreading-page";
import { ja_jp_quality_rule_editor } from "./quality-rule-editor";
import { ja_jp_task_progress } from "./task-progress";
import { ja_jp_text_preserve_page } from "./text-preserve-page";
import { ja_jp_text_replacement_page } from "./text-replacement-page";
import { ja_jp_toolbox_page } from "./toolbox-page";
import { ja_jp_ts_conversion_page } from "./ts-conversion-page";
import { ja_jp_workbench_page } from "./workbench-page";
import type { zh_cn_messages } from "../zh-CN";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_messages = {
  agent_page: ja_jp_agent_page,
  agent_runtime: ja_jp_agent_runtime,
  app: ja_jp_app,
  basic_settings_page: ja_jp_basic_settings_page,
  batch_translation: ja_jp_batch_translation,
  custom_prompt_page: ja_jp_custom_prompt_page,
  expert_settings_page: ja_jp_expert_settings_page,
  glossary_page: ja_jp_glossary_page,
  laboratory_page: ja_jp_laboratory_page,
  log_window_page: ja_jp_log_window_page,
  model_page: ja_jp_model_page,
  post_translation_replacement_page: ja_jp_post_translation_replacement_page,
  pre_translation_replacement_page: ja_jp_pre_translation_replacement_page,
  preset_editor: ja_jp_preset_editor,
  project_page: ja_jp_project_page,
  proofreading_page: ja_jp_proofreading_page,
  quality_rule_editor: ja_jp_quality_rule_editor,
  task_progress: ja_jp_task_progress,
  text_preserve_page: ja_jp_text_preserve_page,
  text_replacement_page: ja_jp_text_replacement_page,
  toolbox_page: ja_jp_toolbox_page,
  ts_conversion_page: ja_jp_ts_conversion_page,
  workbench_page: ja_jp_workbench_page,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>;
