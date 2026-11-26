import { zh_cn_project } from "../zh-CN/project";
import type { LocaleMessageSchema } from "../../types";

export const en_us_project = {
  language: {
    // 非中文界面共用语言码，新增语言只需维护这一份映射。
    short: {
      ALL: "ALL",
      ZH: "ZH",
      "ZH-HANT": "ZH-HANT",
      EN: "EN",
      JA: "JA",
      KO: "KO",
      RU: "RU",
      AR: "AR",
      DE: "DE",
      FR: "FR",
      PL: "PL",
      ES: "ES",
      IT: "IT",
      PT: "PT",
      HU: "HU",
      TR: "TR",
      TH: "TH",
      ID: "ID",
      VI: "VI",
    },
    title: "Project languages",
    source_description: "Set the language of the input text",
    target_description: "Set the language of the output text",
  },
  create: {
    title: "Create project",
    loading_toast: "Creating project …",
    success: "Project created …",
    default_preset_loaded: "Default presets loaded: {NAMES} …",
    default_presets: {
      glossary: "Glossary",
      text_preserve: "Text preserve",
      pre_translation_replacement: "Pre-translation replacement",
      post_translation_replacement: "Post-translation replacement",
      translation_prompt: "Translation prompt",
    },
  },
  open: {
    title: "Open project",
    drop_title: "Click or drag .lg file",
    loading_toast: "Loading project …",
    remove_unavailable:
      "Unable to remove this recent project entry right now. Please try again later …",
    newer_app_version_description:
      "This file targets app version <emphasis>v{VERSION}</emphasis>. Opening it with an older app version may corrupt data. Do you confirm that you want to continue …?",
    missing_file_description: "The project file is invalid. Remove it from the list …?",
  },
  rename: "Rename Project",
  close: {
    action: "Close",
    confirm: "Confirm closing the current project …?",
    failed: "Failed to close the project. Please try again later …",
  },
  preview: {
    file_count: "File count",
    files: "{COUNT} files",
    created_at: "Created at",
    updated_at: "Last updated",
    progress: "Progress",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;
