import { ko_kr_agent_page } from "./agent-page";
import { ko_kr_agent_runtime } from "./agent-runtime";
import { ko_kr_app } from "./app";
import { ko_kr_basic_settings_page } from "./basic-settings-page";
import { ko_kr_batch_translation } from "./batch-translation";
import { ko_kr_custom_prompt_page } from "./custom-prompt-page";
import { ko_kr_expert_settings_page } from "./expert-settings-page";
import { ko_kr_glossary_page } from "./glossary-page";
import { ko_kr_laboratory_page } from "./laboratory-page";
import { ko_kr_log_window_page } from "./log-window-page";
import { ko_kr_model_page } from "./model-page";
import { ko_kr_post_translation_replacement_page } from "./post-translation-replacement-page";
import { ko_kr_pre_translation_replacement_page } from "./pre-translation-replacement-page";
import { ko_kr_preset_editor } from "./preset-editor";
import { ko_kr_project_page } from "./project-page";
import { ko_kr_proofreading_page } from "./proofreading-page";
import { ko_kr_quality_rule_editor } from "./quality-rule-editor";
import { ko_kr_task_progress } from "./task-progress";
import { ko_kr_text_preserve_page } from "./text-preserve-page";
import { ko_kr_text_replacement_page } from "./text-replacement-page";
import { ko_kr_toolbox_page } from "./toolbox-page";
import { ko_kr_ts_conversion_page } from "./ts-conversion-page";
import { ko_kr_workbench_page } from "./workbench-page";
import type { zh_cn_messages } from "../zh-CN";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_messages = {
  agent_page: ko_kr_agent_page,
  agent_runtime: ko_kr_agent_runtime,
  app: ko_kr_app,
  basic_settings_page: ko_kr_basic_settings_page,
  batch_translation: ko_kr_batch_translation,
  custom_prompt_page: ko_kr_custom_prompt_page,
  expert_settings_page: ko_kr_expert_settings_page,
  glossary_page: ko_kr_glossary_page,
  laboratory_page: ko_kr_laboratory_page,
  log_window_page: ko_kr_log_window_page,
  model_page: ko_kr_model_page,
  post_translation_replacement_page: ko_kr_post_translation_replacement_page,
  pre_translation_replacement_page: ko_kr_pre_translation_replacement_page,
  preset_editor: ko_kr_preset_editor,
  project_page: ko_kr_project_page,
  proofreading_page: ko_kr_proofreading_page,
  quality_rule_editor: ko_kr_quality_rule_editor,
  task_progress: ko_kr_task_progress,
  text_preserve_page: ko_kr_text_preserve_page,
  text_replacement_page: ko_kr_text_replacement_page,
  toolbox_page: ko_kr_toolbox_page,
  ts_conversion_page: ko_kr_ts_conversion_page,
  workbench_page: ko_kr_workbench_page,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>;
