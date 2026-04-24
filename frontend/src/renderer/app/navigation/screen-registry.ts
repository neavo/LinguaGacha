import { createElement } from "react";

import { BasicSettingsPage } from "@/pages/basic-settings-page/page";
import { CustomPromptPage } from "@/pages/custom-prompt-page/page";
import { ExpertSettingsPage } from "@/pages/expert-settings-page/page";
import { GlossaryPage } from "@/pages/glossary-page/page";
import { LaboratoryPage } from "@/pages/laboratory-page/page";
import { ModelPage } from "@/pages/model-page/page";
import { NameFieldExtractionPage } from "@/pages/name-field-extraction-page/page";
import { ProofreadingPage } from "@/pages/proofreading-page/page";
import { ProjectPage } from "@/pages/project-page/page";
import { TextPreservePage } from "@/pages/text-preserve-page/page";
import { ToolboxPage } from "@/pages/toolbox-page/page";
import { TextReplacementPage } from "@/pages/text-replacement-page/page";
import { TsConversionPage } from "@/pages/ts-conversion-page/page";
import { WorkbenchPage } from "@/pages/workbench-page/page";
import type { ScreenComponentProps, ScreenRegistry } from "@/app/navigation/types";
import type {
  ProjectPagesRuntimeAdapterOptions,
  ProjectPagesRuntimeAdapters,
} from "@/app/runtime/project-pages/project-pages-runtime-adapter";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";
import { useWorkbenchLiveState } from "@/pages/workbench-page/use-workbench-live-state";

function PreTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: "pre" });
}

function PostTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: "post" });
}

function TranslationPromptScreen(props: ScreenComponentProps): ReturnType<typeof createElement> {
  return createElement(CustomPromptPage, { ...props, variant: "translation" });
}

function AnalysisPromptScreen(props: ScreenComponentProps): ReturnType<typeof createElement> {
  return createElement(CustomPromptPage, { ...props, variant: "analysis" });
}

export function useProjectPagesRuntimeAdapters(
  options: ProjectPagesRuntimeAdapterOptions,
): ProjectPagesRuntimeAdapters {
  return {
    proofreading_page_state: useProofreadingPageState(),
    workbench_live_state: useWorkbenchLiveState(options),
  };
}

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
