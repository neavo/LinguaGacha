import { zh_cn_app } from "@/i18n/resources/zh-CN/app";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_app = {
  aria: {
    toggle_navigation: "Toggle navigation",
  },
  metadata: {
    app_name: "LinguaGacha",
  },
  action: {
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    reset: "Reset",
    retry: "Retry",
    loading: "Loading",
    select_file: "Select File",
    select_folder: "Select Folder",
  },
  feedback: {
    save_success: "Saved …",
    no_valid_data: "No valid data …",
    update_failed: "Update failed …",
  },
  close_confirm: {
    description: "Confirm exiting the app …?",
  },
  update: {
    toast: "New version is available, click the bottom-left update entry to download it …",
  },
  drop: {
    multiple_unavailable: "Only one file can be dropped at a time",
    unavailable:
      "The local path of the dropped file is unavailable right now. Please use the import picker instead.",
    import_here: "Release to import the rule file",
  },
  toggle: {
    disabled: "OFF",
    enabled: "ON",
  },
  drag: {
    enabled: "Drag to reorder",
    disabled: "Drag disabled",
  },
  language: {
    ALL: "All",
    ZH: "Chinese",
    EN: "English",
    JA: "Japanese",
    KO: "Korean",
    RU: "Russian",
    AR: "Arabic",
    DE: "German",
    FR: "French",
    PL: "Polish",
    ES: "Spanish",
    IT: "Italian",
    PT: "Portuguese",
    HU: "Hungarian",
    TR: "Turkish",
    TH: "Thai",
    ID: "Indonesian",
    VI: "Vietnamese",
  },
  navigation_action: {
    theme: "Theme",
    language: "Language",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "Open the GitHub repository",
    update_available: "Download new version …!",
    update_available_tooltip: "Open the GitHub Release page",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;
