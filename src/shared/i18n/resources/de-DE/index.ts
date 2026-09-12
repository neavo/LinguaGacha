import { de_de_batch_translation } from "./batch-translation";
import { de_de_agent_page } from "./agent-page";
import { de_de_agent_runtime } from "./agent-runtime";
import { de_de_app } from "./app";
import { de_de_basic_settings_page } from "./basic-settings-page";
import { de_de_custom_prompt_page } from "./custom-prompt-page";
import { de_de_expert_settings_page } from "./expert-settings-page";
import { de_de_glossary_page } from "./glossary-page";
import { de_de_laboratory_page } from "./laboratory-page";
import { de_de_log_window_page } from "./log-window-page";
import { de_de_model_page } from "./model-page";
import { de_de_post_translation_replacement_page } from "./post-translation-replacement-page";
import { de_de_pre_translation_replacement_page } from "./pre-translation-replacement-page";
import { de_de_preset_editor } from "./preset-editor";
import { de_de_proofreading_page } from "./proofreading-page";
import { de_de_project_page } from "./project-page";
import { de_de_quality_rule_editor } from "./quality-rule-editor";
import { de_de_task_progress } from "./task-progress";
import { de_de_text_preserve_page } from "./text-preserve-page";
import { de_de_text_replacement_page } from "./text-replacement-page";
import { de_de_toolbox_page } from "./toolbox-page";
import { de_de_ts_conversion_page } from "./ts-conversion-page";
import { de_de_workbench_page } from "./workbench-page";
import type { zh_cn_messages } from "../zh-CN";
import type { LocaleMessageSchema } from "../../types";

export const de_de_messages = {
  agent_page: de_de_agent_page,
  agent_runtime: de_de_agent_runtime,
  app: de_de_app,
  basic_settings_page: de_de_basic_settings_page,
  custom_prompt_page: de_de_custom_prompt_page,
  expert_settings_page: de_de_expert_settings_page,
  glossary_page: de_de_glossary_page,
  laboratory_page: de_de_laboratory_page,
  log_window_page: de_de_log_window_page,
  model_page: de_de_model_page,
  post_translation_replacement_page: de_de_post_translation_replacement_page,
  pre_translation_replacement_page: de_de_pre_translation_replacement_page,
  preset_editor: de_de_preset_editor,
  proofreading_page: de_de_proofreading_page,
  project_page: de_de_project_page,
  quality_rule_editor: de_de_quality_rule_editor,
  task_progress: de_de_task_progress,
  text_preserve_page: de_de_text_preserve_page,
  text_replacement_page: de_de_text_replacement_page,
  toolbox_page: de_de_toolbox_page,
  ts_conversion_page: de_de_ts_conversion_page,
  workbench_page: de_de_workbench_page,
  batch_translation: de_de_batch_translation,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>;
