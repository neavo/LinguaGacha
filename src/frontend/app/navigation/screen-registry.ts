import { createElement } from "react";

import { BasicSettingsPage } from "@frontend/pages/basic-settings-page/page";
import { CustomPromptPage } from "@frontend/pages/custom-prompt-page/page";
import { ExpertSettingsPage } from "@frontend/pages/expert-settings-page/page";
import { GlossaryPage } from "@frontend/pages/glossary-page/page";
import { LaboratoryPage } from "@frontend/pages/laboratory-page/page";
import { ModelPage } from "@frontend/pages/model-page/page";
import { NameFieldExtractionPage } from "@frontend/pages/name-field-extraction-page/page";
import { ProofreadingPage } from "@frontend/pages/proofreading-page/page";
import { ProjectPage } from "@frontend/pages/project-page/page";
import { TextPreservePage } from "@frontend/pages/text-preserve-page/page";
import { ToolboxPage } from "@frontend/pages/toolbox-page/page";
import { TextReplacementPage } from "@frontend/pages/text-replacement-page/page";
import { TsConversionPage } from "@frontend/pages/ts-conversion-page/page";
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

// 将通用提示词页面固定为翻译提示词入口。
function TranslationPromptScreen(props: ScreenComponentProps): ReturnType<typeof createElement> {
  return createElement(CustomPromptPage, { ...props, variant: "translation" });
}

// 将通用提示词页面固定为分析提示词入口。
function AnalysisPromptScreen(props: ScreenComponentProps): ReturnType<typeof createElement> {
  return createElement(CustomPromptPage, { ...props, variant: "analysis" });
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
  proofreading: {
    component: ProofreadingPage,
    title_key: "proofreading_page.title",
  },
  workbench: {
    component: WorkbenchPage,
    title_key: "workbench_page.title",
  },
  "basic-settings": {
    component: BasicSettingsPage,
    title_key: "basic_settings_page.title",
  },
  "expert-settings": {
    component: ExpertSettingsPage,
    title_key: "expert_settings_page.title",
  },
  glossary: {
    component: GlossaryPage,
    title_key: "glossary_page.title",
  },
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
  "translation-prompt": {
    component: TranslationPromptScreen,
    title_key: "translation_prompt_page.title",
  },
  "analysis-prompt": {
    component: AnalysisPromptScreen,
    title_key: "analysis_prompt_page.title",
  },
  laboratory: {
    component: LaboratoryPage,
    title_key: "laboratory_page.title",
  },
  toolbox: {
    component: ToolboxPage,
    title_key: "toolbox_page.title",
  },
  "name-field-extraction": {
    component: NameFieldExtractionPage,
    title_key: "name_field_extraction_page.title",
  },
  "ts-conversion": {
    component: TsConversionPage,
    title_key: "ts_conversion_page.title",
  },
};
