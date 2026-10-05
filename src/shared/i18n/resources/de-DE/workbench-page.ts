import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_workbench_page = {
  title: "Werkbank",
  unit: {
    line: "Zeile",
  },
  table: {
    file_name: "Dateiname",
    progress: "Fortschritt",
    agent: "AGENT",
    agent_only: "Diese Datei kann nur mit AGENT übersetzt werden",
    actions: "Aktionen",
  },
  feedback: {
    add_file_loading_toast: "Datei wird hinzugefügt und Cache aktualisiert …",
    no_valid_file: "Keine gültigen Dateien können hinzugefügt werden",
    close_project_failed:
      "Fehler beim Schließen des Projekts. Bitte versuchen Sie es später erneut …",
  },
  action: {
    add_file: "Hinzufügen",
    close_project: "Schließen",
    reset: "Übersetzung zurücksetzen",
    translation_task: "Übersetzung",
    start_translation: "Übersetzung starten",
    reset_task_all: "Alle Daten zurücksetzen",
    reset_task_failed: "Fehlgeschlagenes zurücksetzen",
  },
  dialog: {
    import_conflict: {
      description:
        "{COUNT} Dateien mit demselben Namen wurden erkannt. Wählen Sie, wie damit umgegangen werden soll …",
    },
    inherit_import: {
      description:
        "Abgeschlossene Übersetzungen aus dem aktuellen Projekt verwenden, um die neuen Dateien zu füllen …?",
      fill: "Füllen",
      do_not_fill: "Nicht füllen",
    },
    reset: {
      description: "Übersetzungsstatus dieser Datei wirklich zurücksetzen …?",
    },
    delete: {
      description:
        "Ausgewählte Datei und alle zugehörigen Übersetzungseinträge wirklich löschen …?",
    },
    close_project: {
      description: "Aktuelles Projekt wirklich schließen …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
