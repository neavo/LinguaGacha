import { pt_br_knowledge_page } from "./knowledge-page";
import { pt_br_project_knowledge } from "./project-knowledge";
import { pt_br_game_font_page } from "./game-font-page";
import { pt_br_translation_transfer_page } from "./translation-transfer-page";
import { pt_br_toolbox_page } from "./toolbox-page";
import { pt_br_batch_translation } from "./batch-translation";
import { pt_br_agent_page } from "./agent-page";
import { pt_br_agent_runtime } from "./agent-runtime";
import { pt_br_app } from "./app";
import { pt_br_function_settings_page } from "./function-settings-page";
import { pt_br_custom_prompt_page } from "./custom-prompt-page";
import { pt_br_glossary_page } from "./glossary-page";
import { pt_br_laboratory_page } from "./laboratory-page";
import { pt_br_log_window_page } from "./log-window-page";
import { pt_br_model_page } from "./model-page";
import { pt_br_post_translation_replacement_page } from "./post-translation-replacement-page";
import { pt_br_pre_translation_replacement_page } from "./pre-translation-replacement-page";
import { pt_br_preset_editor } from "./preset-editor";
import { pt_br_proofreading_page } from "./proofreading-page";
import { pt_br_project } from "./project";
import { pt_br_quality_rule_editor } from "./quality-rule-editor";
import { pt_br_task_progress } from "./task-progress";
import { pt_br_text_preserve_page } from "./text-preserve-page";
import { pt_br_text_replacement_page } from "./text-replacement-page";
import { pt_br_workbench_page } from "./workbench-page";
import type { zh_cn_messages } from "../zh-CN";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_messages = {
  knowledge_page: pt_br_knowledge_page,
  project_knowledge: pt_br_project_knowledge,
  agent_page: pt_br_agent_page,
  agent_runtime: pt_br_agent_runtime,
  app: pt_br_app,
  function_settings_page: pt_br_function_settings_page,
  custom_prompt_page: pt_br_custom_prompt_page,
  glossary_page: pt_br_glossary_page,
  laboratory_page: pt_br_laboratory_page,
  toolbox_page: pt_br_toolbox_page,
  game_font_page: pt_br_game_font_page,
  translation_transfer_page: pt_br_translation_transfer_page,
  log_window_page: pt_br_log_window_page,
  model_page: pt_br_model_page,
  post_translation_replacement_page: pt_br_post_translation_replacement_page,
  pre_translation_replacement_page: pt_br_pre_translation_replacement_page,
  preset_editor: pt_br_preset_editor,
  proofreading_page: pt_br_proofreading_page,
  project: pt_br_project,
  quality_rule_editor: pt_br_quality_rule_editor,
  task_progress: pt_br_task_progress,
  text_preserve_page: pt_br_text_preserve_page,
  text_replacement_page: pt_br_text_replacement_page,
  workbench_page: pt_br_workbench_page,
  batch_translation: pt_br_batch_translation,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>;
