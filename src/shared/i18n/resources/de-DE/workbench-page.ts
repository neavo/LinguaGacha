import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_workbench_page = {
  title: "Werkbank",
  unit: {
    item: "Einträge",
  },
  table: {
    file_name: "Dateiname",
    progress: "Fortschritt",
    agent: "AGENT",
    agent_writeback: "AGENT wird zum Zurückschreiben ins Originalformat benötigt",
    agent_only: "Übersetzung nur mit AGENT möglich",
    agent_recommended: "Wir empfehlen AGENT für die Übersetzung",
  },
  feedback: {
    no_valid_file: "Keine gültigen Dateien können hinzugefügt werden",
  },
  action: {
    add_file: "Hinzufügen",
    rename: "Umbenennen",
    reset: "Dateidaten zurücksetzen",
    translation_task: "Übersetzung",
    start_translation: "Übersetzung starten",
    reset_task_all: "Alle Daten zurücksetzen",
  },
  dialog: {
    import_conflict: {
      description:
        "{COUNT} Dateien mit demselben Namen wurden erkannt. Wählen Sie, wie damit umgegangen werden soll …",
    },
    inherit_import: {
      description:
        "Abgeschlossene Übersetzungen verwenden, um die importierten Dateien zu füllen …?",
      fill: "Füllen",
      do_not_fill: "Nicht füllen",
    },
    rename: {
      exists: "Eine Datei oder ein Ordner mit diesem Namen existiert bereits",
      invalid_name:
        'Der Name darf nicht leer sein, kein \\ / : * ? " < > | enthalten und nicht mit einem Punkt enden',
    },
    reset: {
      description:
        "Ausgewählte Datei und alle zugehörigen Übersetzungseinträge wirklich zurücksetzen …?",
    },
    delete: {
      description:
        "Ausgewählte Datei und alle zugehörigen Übersetzungseinträge wirklich löschen …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
