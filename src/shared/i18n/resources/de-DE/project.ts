import { en_us_project } from "../en-US/project";
import { zh_cn_project } from "../zh-CN/project";
import type { LocaleMessageSchema } from "../../types";

export const de_de_project = {
  language: {
    short: en_us_project.language.short,
    title: "Projektsprachen",
    source_description: "Legt die Sprache des Eingabetexts fest",
    target_description: "Legt die Sprache des Ausgabetexts fest",
  },
  create: {
    title: "Projekt erstellen",
    loading_toast: "Projekt wird erstellt …",
    success: "Projekt erstellt …",
    default_preset_loaded: "Standard-Voreinstellungen geladen: {NAMES} …",
    default_presets: {
      glossary: "Glossar",
      text_preserve: "Textschutz",
      pre_translation_replacement: "Ersetzung vor Übersetzung",
      post_translation_replacement: "Ersetzung nach Übersetzung",
      translation_prompt: "Übersetzungs-Prompt",
    },
  },
  open: {
    title: "Projekt öffnen",
    drop_title: "Klicken oder .lg-Datei hierher ziehen",
    loading_toast: "Projekt wird geladen …",
    remove_unavailable:
      "Dieser Eintrag der zuletzt verwendeten Projekte kann derzeit nicht entfernt werden. Bitte später erneut versuchen …",
    newer_app_version_description:
      "Diese Datei ist für App-Version <emphasis>v{VERSION}</emphasis> vorgesehen. Das Öffnen mit einer älteren App-Version kann Daten beschädigen. Trotzdem öffnen …?",
    missing_file_description: "Die Projektdatei ist ungültig. Aus der Liste entfernen …?",
  },
  close: {
    action: "Schließen",
    confirm: "Aktuelles Projekt wirklich schließen …?",
    failed: "Projekt konnte nicht geschlossen werden. Bitte später erneut versuchen …",
  },
  preview: {
    file_count: "Dateianzahl",
    files: "{COUNT} Dateien",
    created_at: "Erstellt am",
    updated_at: "Zuletzt aktualisiert",
    progress: "Fortschritt",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;
