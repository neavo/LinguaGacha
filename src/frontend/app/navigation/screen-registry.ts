import { createElement } from "react";

import { FunctionSettingsPage } from "@frontend/pages/function-settings-page/page";
import { AgentPage } from "@frontend/pages/agent-page/page";
import { CustomPromptPage } from "@frontend/pages/custom-prompt-page/page";
import { GameFontPage } from "@frontend/pages/game-font-page/page";
import { GlossaryPage } from "@frontend/pages/glossary-page/page";
import { LaboratoryPage } from "@frontend/pages/laboratory-page/page";
import { ModelPage } from "@frontend/pages/model-page/page";
import { SkillsPage } from "@frontend/pages/skills-page/page";
import { ProofreadingPage } from "@frontend/pages/proofreading-page/page";
import { ProjectPage } from "@frontend/pages/project-page/page";
import { TextPreservePage } from "@frontend/pages/text-preserve-page/page";
import { TextReplacementPage } from "@frontend/pages/text-replacement-page/page";
import { ToolboxPage } from "@frontend/pages/toolbox-page/page";
import { TranslationTransferPage } from "@frontend/pages/translation-transfer-page/page";
import { WorkbenchPage } from "@frontend/pages/workbench-page/page";
import type { ScreenComponentProps, ScreenRegistry } from "@frontend/app/navigation/types";

// 将通用替换页面固定为译前替换入口，供路由表直接消费。
function PreTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: "pre" });
}

// 将通用替换页面固定为译后替换入口，避免路由侧散落 variant。
function PostTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: "post" });
}

// 导航 route 到页面组件与标题 key 的唯一映射。
export const SCREEN_REGISTRY: ScreenRegistry = {
  "project-home": {
    component: ProjectPage,
    title_key: "project_page.title",
  },
  model: {
    component: ModelPage,
    title_key: "model_page.title",
  },
  agent: {
    component: AgentPage,
    title_key: "agent_page.title",
    workspace_layout: "edge-to-edge",
  },
  proofreading: {
    component: ProofreadingPage,
    title_key: "proofreading_page.title",
  },
  workbench: {
    component: WorkbenchPage,
    title_key: "workbench_page.title",
  },
  "function-settings": {
    component: FunctionSettingsPage,
    title_key: "function_settings_page.title",
  },
  glossary: {
    component: GlossaryPage,
    title_key: "glossary_page.title",
  },
  skills: { component: SkillsPage, title_key: "skills_page.title" },
  "text-preserve": {
    component: TextPreservePage,
    title_key: "text_preserve_page.title",
  },
  "pre-translation-replacement": {
    component: PreTranslationReplacementScreen,
    title_key: "pre_translation_replacement_page.title",
  },
  "post-translation-replacement": {
    component: PostTranslationReplacementScreen,
    title_key: "post_translation_replacement_page.title",
  },
  "custom-prompt": {
    component: CustomPromptPage,
    title_key: "custom_prompt_page.title",
  },

  laboratory: {
    component: LaboratoryPage,
    title_key: "laboratory_page.title",
  },
  toolbox: {
    component: ToolboxPage,
    title_key: "toolbox_page.title",
  },
  "game-font": {
    component: GameFontPage,
    title_key: "game_font_page.title",
  },
  "translation-transfer": {
    component: TranslationTransferPage,
    title_key: "translation_transfer_page.title",
  },
};
