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
    start_translation: {
      agent_recommended:
        "Für eine höhere Übersetzungsqualität empfehlen wir die Übersetzung mit AGENT …!",
      agent_required:
        "Das Projekt enthält komplexe Daten, die von AGENT verarbeitet werden müssen. Für eine höhere Übersetzungsqualität empfehlen wir die Übersetzung mit AGENT …!",
      translate_directly: "Direkt übersetzen",
    },
    import_conflict: {
      description: "{COUNT} Dateien mit demselben Namen erkannt. Bitte Vorgehensweise wählen …",
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
