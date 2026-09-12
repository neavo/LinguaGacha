import { en_us_batch_translation } from "./batch-translation";
import { en_us_agent_page } from "./agent-page";
import { en_us_agent_runtime } from "./agent-runtime";
import { en_us_app } from "./app";
import { en_us_basic_settings_page } from "./basic-settings-page";
import { en_us_custom_prompt_page } from "./custom-prompt-page";
import { en_us_expert_settings_page } from "./expert-settings-page";
import { en_us_glossary_page } from "./glossary-page";
import { en_us_laboratory_page } from "./laboratory-page";
import { en_us_log_window_page } from "./log-window-page";
import { en_us_model_page } from "./model-page";
import { en_us_post_translation_replacement_page } from "./post-translation-replacement-page";
import { en_us_pre_translation_replacement_page } from "./pre-translation-replacement-page";
import { en_us_preset_editor } from "./preset-editor";
import { en_us_proofreading_page } from "./proofreading-page";
import { en_us_project_page } from "./project-page";
import { en_us_quality_rule_editor } from "./quality-rule-editor";
import { en_us_task_progress } from "./task-progress";
import { en_us_text_preserve_page } from "./text-preserve-page";
import { en_us_text_replacement_page } from "./text-replacement-page";
import { en_us_toolbox_page } from "./toolbox-page";
import { en_us_ts_conversion_page } from "./ts-conversion-page";
import { en_us_workbench_page } from "./workbench-page";
import type { zh_cn_messages } from "../zh-CN";
import type { LocaleMessageSchema } from "../../types";

export const en_us_messages = {
  agent_page: en_us_agent_page,
  agent_runtime: en_us_agent_runtime,
  app: en_us_app,
  basic_settings_page: en_us_basic_settings_page,
  custom_prompt_page: en_us_custom_prompt_page,
  expert_settings_page: en_us_expert_settings_page,
  glossary_page: en_us_glossary_page,
  laboratory_page: en_us_laboratory_page,
  log_window_page: en_us_log_window_page,
  model_page: en_us_model_page,
  post_translation_replacement_page: en_us_post_translation_replacement_page,
  pre_translation_replacement_page: en_us_pre_translation_replacement_page,
  preset_editor: en_us_preset_editor,
  proofreading_page: en_us_proofreading_page,
  project_page: en_us_project_page,
  quality_rule_editor: en_us_quality_rule_editor,
  task_progress: en_us_task_progress,
  text_preserve_page: en_us_text_preserve_page,
  text_replacement_page: en_us_text_replacement_page,
  toolbox_page: en_us_toolbox_page,
  ts_conversion_page: en_us_ts_conversion_page,
  workbench_page: en_us_workbench_page,
  batch_translation: en_us_batch_translation,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>;
