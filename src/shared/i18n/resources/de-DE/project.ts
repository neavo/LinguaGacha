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
    drop_title: "Klicken oder Quelldatei hierher ziehen",
    ready_status: "{COUNT} Quelldateien ausgewählt",
    unavailable: "Die Auswahl enthält keine unterstützten Quelldateien",
    title: "Projekt erstellen",
    loading_toast: "Projekt wird erstellt …",
    success: "Projekt erstellt …",
    agent_draft: {
      import:
        "Erkenne übersetzbare Inhalte unter den folgenden Pfaden und füge sie in geeigneter Form zum Projekt hinzu:",
    },
    default_preset_loaded: "Standard-Voreinstellungen geladen: {NAMES} …",
    default_presets: {
      glossary: "Glossar",
      text_preserve: "Textschutz",
      pre_translation_replacement: "Ersetzung vor Übersetzung",
      post_translation_replacement: "Ersetzung nach Übersetzung",
      translation_prompt: "Übersetzungs-Prompt",
    },
    action: "Projekt erstellen",
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
  formats: {
    media: "Audio und Video",
    title_tooltip: "Schneller, besser und zuverlässiger",
    deprecated_tooltip:
      "Nicht mehr die beste Wahl. Bitte bevorzugt die oben genannten Formate verwenden",
    empty_project_hint:
      "Keine Dateien auswählen: Einfach auf „{ACTION}“ klicken und die Dateien dann in das AGENT-Eingabefeld ziehen …!",
    generic: "Generische Daten",
    title: "Besonders optimierte Formate",
    txt: "Nur Text",
    md: "Markdown",
    ass: "ASS-Untertitel",
    ssa: "SSA-Untertitel",
    lrc: "LRC-Untertitel",
    srt: "SubRip-Untertitel",
    vtt: "WebVTT-Untertitel",
    pdf: "PDF-E-Book",
    epub: "EPUB-E-Book",
    json: "JSON-Spieltext",
    mtool: "MTool-Spieltext",
    sextractor: "SExtractor-Spieltext",
    vntextpatch: "VNTextPatch-Spieltext",
    godot: "Godot-Spieldateien",
    action_game_maker: "ACTION GAME MAKER Spieldateien",
    renpy: "RenPy-Spieldateien",
    tyrano: "Tyrano-Spieldateien",
    wolfrpg: "WOLFRPG-Spieldateien",
    rpgmaker_mv_mz: "RPGMAKER MV/MZ Spieldatei",
    rpgmaker_rgss: "RPGMAKER XP/VX/VXAce Spieldatei",
    deprecated_title: "Besonders optimierte Formate (Unterstützung endet bald)",
    any_format_notice:
      "Spiele, Untertitel und E-Books in anderen Formaten werden ebenfalls unterstützt, auch wenn sie oben nicht aufgeführt sind",
    rpy: "RenPy-Spieltext",
    xlsx: "XLSX-Spieltext",
    trans_export: "Translator++ Spieltext",
    wolf: "Vom offiziellen WOLF-Übersetzungstool exportierter Spieltext",
    trans: "Translator++ Projektdatei",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;
