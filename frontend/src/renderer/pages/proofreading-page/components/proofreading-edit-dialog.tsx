import { Recycle, RefreshCcw } from "lucide-react";

import { useI18n } from "@/i18n";
import { useSaveShortcut } from "@/hooks/use-save-shortcut";
import {
  ProofreadingCodeEditor,
  type ProofreadingCodeEditorHighlight,
} from "@/pages/proofreading-page/components/proofreading-code-editor";
import {
  format_proofreading_glossary_term,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
} from "@/pages/proofreading-page/types";
import { Badge } from "@/shadcn/badge";
import { Button } from "@/shadcn/button";
import { Kbd } from "@/shadcn/kbd";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";

type ProofreadingEditDialogProps = {
  open: boolean;
  item: ProofreadingItem | null;
  draft_dst: string;
  saving: boolean;
  readonly: boolean;
  on_change: (next_draft_dst: string) => void;
  on_save: () => Promise<void>;
  on_close: () => void;
  on_request_retranslate: (row_ids: string[]) => void;
  on_request_reset: (row_ids: string[]) => void;
};

type ProofreadingBadgeTone = "neutral" | "success" | "warning" | "failure";

function resolve_status_badge_tone(status: string): ProofreadingBadgeTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }
  if (status === "PROCESSED_IN_PAST") {
    return "warning";
  }

  return "neutral";
}

function resolve_warning_badge_tone(): ProofreadingBadgeTone {
  return "warning";
}

function resolve_badge_tone_class_name(tone: ProofreadingBadgeTone): string {
  return `proofreading-page__dialog-status-badge--tone-${tone}`;
}

function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return format_proofreading_glossary_term(term);
}

function dedupe_glossary_terms(
  terms: ProofreadingGlossaryTerm[],
): ProofreadingGlossaryTerm[] {
  const term_map = new Map<string, ProofreadingGlossaryTerm>();
  terms.forEach((term) => {
    term_map.set(build_glossary_term_key(term), term);
  });
  return [...term_map.values()];
}

function is_glossary_term_applied(
  term: ProofreadingGlossaryTerm,
  draft_dst: string,
): boolean {
  return term[1].trim().length > 0 && draft_dst.includes(term[1]);
}

function partition_glossary_terms(
  item: ProofreadingItem,
  draft_dst: string,
): {
  applied_terms: ProofreadingGlossaryTerm[];
  failed_terms: ProofreadingGlossaryTerm[];
} {
  // 为什么：弹窗里展示的是“当前草稿”的真实状态，术语胶囊和下划线都要跟着 draft_dst 实时刷新。
  const all_terms = dedupe_glossary_terms([
    ...item.applied_glossary_terms,
    ...item.failed_glossary_terms,
  ]);
  const applied_terms = all_terms.filter((term) =>
    is_glossary_term_applied(term, draft_dst),
  );
  const failed_terms = all_terms.filter(
    (term) => !is_glossary_term_applied(term, draft_dst),
  );

  return {
    applied_terms,
    failed_terms,
  };
}

function find_text_match_ranges(
  text: string,
  fragment: string,
): Array<Pick<ProofreadingCodeEditorHighlight, "start" | "end">> {
  if (fragment.length === 0) {
    return [];
  }

  const ranges: Array<Pick<ProofreadingCodeEditorHighlight, "start" | "end">> =
    [];
  let search_start = 0;

  while (search_start < text.length) {
    const match_start = text.indexOf(fragment, search_start);

    if (match_start < 0) {
      break;
    }

    ranges.push({
      start: match_start,
      end: match_start + fragment.length,
    });
    search_start = match_start + fragment.length;
  }

  return ranges;
}

function build_glossary_highlights(
  item: ProofreadingItem,
  draft_dst: string,
  t: ReturnType<typeof useI18n>["t"],
): {
  source_highlights: ProofreadingCodeEditorHighlight[];
  translation_highlights: ProofreadingCodeEditorHighlight[];
} {
  // 为什么：命中的术语要同时标亮原文和译文，未命中的术语只在原文保留警告提示，方便人工补齐。
  const { applied_terms, failed_terms } = partition_glossary_terms(
    item,
    draft_dst,
  );
  const source_highlights: ProofreadingCodeEditorHighlight[] = [];
  const translation_highlights: ProofreadingCodeEditorHighlight[] = [];

  applied_terms.forEach((term) => {
    find_text_match_ranges(item.src, term[0]).forEach((range) => {
      source_highlights.push({
        ...range,
        tone: "success",
        tooltip: `${t("proofreading_page.glossary.tooltip_applied")}\n${term[0]} -> ${term[1]}`,
      });
    });
    find_text_match_ranges(draft_dst, term[1]).forEach((range) => {
      translation_highlights.push({
        ...range,
        tone: "success",
        tooltip: `${t("proofreading_page.glossary.tooltip_applied")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  failed_terms.forEach((term) => {
    find_text_match_ranges(item.src, term[0]).forEach((range) => {
      source_highlights.push({
        ...range,
        tone: "warning",
        tooltip: `${t("proofreading_page.glossary.tooltip_failed")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  return {
    source_highlights,
    translation_highlights,
  };
}

function resolve_glossary_badge_state(
  item: ProofreadingItem,
  draft_dst: string,
  t: ReturnType<typeof useI18n>["t"],
): {
  label: string;
  tone: ProofreadingBadgeTone;
} | null {
  const { applied_terms, failed_terms } = partition_glossary_terms(
    item,
    draft_dst,
  );

  if (applied_terms.length === 0 && failed_terms.length === 0) {
    return null;
  }

  if (failed_terms.length === 0) {
    return {
      label: t("proofreading_page.glossary.ok"),
      tone: "success",
    };
  }

  if (applied_terms.length === 0) {
    return {
      label: t("proofreading_page.glossary.miss"),
      tone: "failure",
    };
  }

  return {
    label: t("proofreading_page.glossary.partial"),
    tone: "warning",
  };
}

export function ProofreadingEditDialog(
  props: ProofreadingEditDialogProps,
): JSX.Element | null {
  const { t } = useI18n();
  const item = props.item;
  const save_label = t("proofreading_page.action.save");
  const save_disabled = props.readonly || props.saving;

  useSaveShortcut({
    enabled: props.open && !save_disabled,
    on_save: () => {
      void props.on_save();
    },
  });

  if (item === null) {
    return null;
  }

  const status_label_key =
    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
      item.status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
    ];
  const status_badge_tone = resolve_status_badge_tone(item.status);
  const status_label =
    status_label_key === undefined ? item.status : t(status_label_key);
  const glossary_badge_state = resolve_glossary_badge_state(
    item,
    props.draft_dst,
    t,
  );
  const { source_highlights, translation_highlights } =
    build_glossary_highlights(item, props.draft_dst, t);
  const visible_warning_codes =
    glossary_badge_state === null
      ? item.warnings
      : item.warnings.filter((warning) => warning !== "GLOSSARY");

  return (
    <AppPageDialog
      open={props.open}
      title={t("proofreading_page.dialog.edit_title")}
      size="lg"
      dismissBehavior="blocked"
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
      footerClassName="sm:justify-between"
      footer={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.readonly || props.saving}
              onClick={() => {
                props.on_request_retranslate([String(item.item_id)]);
              }}
            >
              <RefreshCcw data-icon="inline-start" />
              {t("proofreading_page.action.retranslate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.readonly || props.saving}
              onClick={() => {
                props.on_request_reset([String(item.item_id)]);
              }}
            >
              <Recycle data-icon="inline-start" />
              {t("proofreading_page.action.reset_translation")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.saving}
              onClick={props.on_close}
            >
              {t("proofreading_page.action.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={save_disabled}
              onClick={() => {
                void props.on_save();
              }}
            >
              {save_label}
              <Kbd className="bg-background/18 text-primary-foreground">
                Ctrl+S
              </Kbd>
            </Button>
          </div>
        </>
      }
    >
      <div className="proofreading-page__dialog-scroll">
        <div className="proofreading-page__dialog-form">
          <div className="proofreading-page__dialog-main-panel">
            <div className="proofreading-page__dialog-main-panel-content">
              <section className="proofreading-page__dialog-file-card">
                <span className="proofreading-page__dialog-file-path">
                  {item.file_path}
                </span>
              </section>

              <section className="proofreading-page__dialog-editor-block">
                <label className="proofreading-page__dialog-editor-section">
                  <span className="proofreading-page__dialog-editor-title font-medium">
                    {t("proofreading_page.fields.source")}
                  </span>
                  <ProofreadingCodeEditor
                    value={item.src}
                    aria_label={t("proofreading_page.fields.source")}
                    read_only
                    highlights={source_highlights}
                    class_name={[
                      "proofreading-page__dialog-editor-host",
                      "proofreading-page__dialog-editor-host--readonly",
                    ].join(" ")}
                  />
                </label>

                <label className="proofreading-page__dialog-editor-section">
                  <span className="proofreading-page__dialog-editor-title font-medium">
                    {t("proofreading_page.fields.translation")}
                  </span>
                  <ProofreadingCodeEditor
                    value={props.draft_dst}
                    aria_label={t("proofreading_page.fields.translation")}
                    read_only={props.readonly || props.saving}
                    highlights={translation_highlights}
                    class_name="proofreading-page__dialog-editor-host"
                    on_change={(next_value) => {
                      props.on_change(next_value);
                    }}
                  />
                </label>
              </section>

              <section className="proofreading-page__dialog-status-section">
                <h3 className="proofreading-page__dialog-status-title font-medium">
                  {t("proofreading_page.fields.status")}
                </h3>
                <div className="proofreading-page__dialog-status-strip">
                  <Badge
                    variant="outline"
                    className={[
                      "proofreading-page__dialog-status-badge",
                      resolve_badge_tone_class_name(status_badge_tone),
                    ]
                      .join(" ")
                      .trim()}
                  >
                    {status_label}
                  </Badge>
                  {glossary_badge_state === null ? null : (
                    <Badge
                      variant="outline"
                      className={[
                        "proofreading-page__dialog-status-badge",
                        resolve_badge_tone_class_name(
                          glossary_badge_state.tone,
                        ),
                      ].join(" ")}
                    >
                      {glossary_badge_state.label}
                    </Badge>
                  )}
                  {visible_warning_codes.map((warning) => {
                    const label_key =
                      PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                        warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                      ];
                    return (
                      <Badge
                        key={warning}
                        variant="outline"
                        className={[
                          "proofreading-page__dialog-status-badge",
                          resolve_badge_tone_class_name(
                            resolve_warning_badge_tone(),
                          ),
                        ].join(" ")}
                      >
                        {label_key === undefined ? warning : t(label_key)}
                      </Badge>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
