import { Eraser, ListChecks, RefreshCcw } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import type { AppTextMark } from "@frontend/widgets/app-editor/app-editor-code-mirror";
import {
  format_proofreading_glossary_term,
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingManualStatusCode,
} from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";
import { read_optional_item_name_text, read_item_name_text } from "@shared/item-name";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";

type ProofreadingEditDialogProps = {
  open: boolean;
  item: ProofreadingItem | null;
  draft_item: {
    dst: string;
    name_dst: string;
  };
  saving: boolean;
  readonly: boolean;
  on_change: (patch: Partial<ProofreadingEditDialogProps["draft_item"]>) => void;
  on_save: () => Promise<void>;
  on_close: () => void;
  on_request_retranslate: (row_ids: string[]) => void;
  on_request_clear_translation: (row_ids: string[]) => void;
  on_request_set_translation_status: (
    row_ids: string[],
    status: ProofreadingManualStatusCode,
  ) => void;
};

type ProofreadingBadgeTone = "neutral" | "success" | "warning" | "failure";

type ProofreadingNameGlossaryState = {
  tone: "neutral" | "success" | "warning";
  applied_terms: ProofreadingGlossaryTerm[];
  failed_terms: ProofreadingGlossaryTerm[];
};

/**
 * 解析当前场景的最终消费值。
 */
function resolve_status_badge_tone(status: string): ProofreadingBadgeTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

/**
 * 解析当前场景的最终消费值。
 */
function resolve_warning_badge_tone(): ProofreadingBadgeTone {
  return "warning";
}

/**
 * 解析当前场景的最终消费值。
 */
function resolve_badge_tone_class_name(tone: ProofreadingBadgeTone): string {
  return `proofreading-page__dialog-status-badge--tone-${tone}`;
}

/**
 * 生成当前场景的展示内容。
 */
function render_fragment_section(title: string, fragments: string[]): JSX.Element | null {
  if (fragments.length === 0) {
    return null;
  }

  return (
    <section className="proofreading-page__dialog-badge-tooltip-section">
      <p className="proofreading-page__dialog-badge-tooltip-title font-medium">{title}</p>
      <ul className="proofreading-page__dialog-badge-tooltip-list">
        {fragments.map((fragment) => (
          <li key={fragment} className="proofreading-page__dialog-badge-tooltip-item">
            {fragment}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 生成当前场景的展示内容。
 */
function render_glossary_tooltip_content(
  applied_terms: ProofreadingGlossaryTerm[],
  failed_terms: ProofreadingGlossaryTerm[],
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  if (applied_terms.length === 0 && failed_terms.length === 0) {
    return null;
  }

  return (
    <div className="proofreading-page__dialog-badge-tooltip-copy">
      {render_fragment_section(
        t("proofreading_page.tooltip.glossary_applied_terms"),
        applied_terms.map((term) => `${term[0]} -> ${term[1]}`),
      )}
      {render_fragment_section(
        t("proofreading_page.tooltip.glossary_failed_terms"),
        failed_terms.map(format_proofreading_glossary_term),
      )}
    </div>
  );
}

/**
 * 生成当前场景的展示内容。
 */
function render_warning_tooltip_content(
  item: ProofreadingItem,
  warning: string,
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  if (warning === "KANA") {
    const fragments = item.warning_fragments_by_code.KANA ?? [];
    return fragments.length === 0 ? null : (
      <div className="proofreading-page__dialog-badge-tooltip-copy">
        {render_fragment_section(t("proofreading_page.tooltip.kana_fragments"), fragments)}
      </div>
    );
  }

  if (warning === "HANGEUL") {
    const fragments = item.warning_fragments_by_code.HANGEUL ?? [];
    return fragments.length === 0 ? null : (
      <div className="proofreading-page__dialog-badge-tooltip-copy">
        {render_fragment_section(t("proofreading_page.tooltip.hangeul_fragments"), fragments)}
      </div>
    );
  }

  if (warning === "TEXT_PRESERVE") {
    const fragments = item.warning_fragments_by_code.TEXT_PRESERVE;
    if (fragments === undefined) {
      return null;
    }

    return (
      <div className="proofreading-page__dialog-badge-tooltip-copy">
        {render_fragment_section(t("proofreading_page.tooltip.text_preserve_failed"), fragments)}
      </div>
    );
  }

  return null;
}

/**
 * 生成当前场景的展示内容。
 */
function render_status_badge(args: {
  label: string;
  tone: ProofreadingBadgeTone;
  tooltip_content?: JSX.Element | null;
}): JSX.Element {
  const class_name = [
    "proofreading-page__dialog-status-badge",
    resolve_badge_tone_class_name(args.tone),
  ].join(" ");
  const badge = (
    <Badge variant="outline" className={class_name}>
      {args.label}
    </Badge>
  );

  if (args.tooltip_content === null || args.tooltip_content === undefined) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="proofreading-page__dialog-badge-tooltip"
      >
        {args.tooltip_content}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 构建当前场景的稳定结果。
 */
function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return format_proofreading_glossary_term(term);
}

/**
 * 整理集合数据并保持下游消费稳定。
 */
function dedupe_glossary_terms(terms: ProofreadingGlossaryTerm[]): ProofreadingGlossaryTerm[] {
  const term_map = new Map<string, ProofreadingGlossaryTerm>();
  terms.forEach((term) => {
    term_map.set(build_glossary_term_key(term), term);
  });
  return [...term_map.values()];
}

/**
 * 判断当前值是否满足业务条件。
 */
function is_glossary_term_applied(
  term: ProofreadingGlossaryTerm,
  draft_item: ProofreadingEditDialogProps["draft_item"],
): boolean {
  return (
    term[1].trim().length > 0 &&
    (draft_item.dst.includes(term[1]) || draft_item.name_dst.includes(term[1]))
  );
}

/**
 * 整理集合数据并保持下游消费稳定。
 */
function partition_glossary_terms(
  item: ProofreadingItem,
  draft_item: ProofreadingEditDialogProps["draft_item"],
): {
  applied_terms: ProofreadingGlossaryTerm[];
  failed_terms: ProofreadingGlossaryTerm[];
} {
  // 为什么：弹窗里展示的是“当前草稿”的真实状态，术语胶囊和下划线都要跟着草稿实时刷新
  const all_terms = dedupe_glossary_terms([
    ...item.applied_glossary_terms,
    ...item.failed_glossary_terms,
  ]);
  const applied_terms = all_terms.filter((term) => is_glossary_term_applied(term, draft_item));
  const failed_terms = all_terms.filter((term) => !is_glossary_term_applied(term, draft_item));

  return {
    applied_terms,
    failed_terms,
  };
}

/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_code_editor_match_text(text: string): string {
  return text.replace(/\r\n|\r/gu, "\n");
}

/**
 * 读取当前场景需要的稳定数据。
 */
export function find_text_match_ranges(
  text: string,
  fragment: string,
): Array<Pick<AppTextMark, "start" | "end">> {
  const editor_text = normalize_code_editor_match_text(text);
  const editor_fragment = normalize_code_editor_match_text(fragment);

  if (editor_fragment.length === 0) {
    return [];
  }

  const ranges: Array<Pick<AppTextMark, "start" | "end">> = [];
  let search_start = 0;

  while (search_start < editor_text.length) {
    const match_start = editor_text.indexOf(editor_fragment, search_start);

    if (match_start < 0) {
      break;
    }

    ranges.push({
      start: match_start,
      end: match_start + editor_fragment.length,
    });
    search_start = match_start + editor_fragment.length;
  }

  return ranges;
}

/**
 * 构建当前场景的稳定结果。
 */
function build_glossary_highlights(
  item: ProofreadingItem,
  draft_item: ProofreadingEditDialogProps["draft_item"],
  t: ReturnType<typeof useI18n>["t"],
): {
  source_marks: AppTextMark[];
  translation_marks: AppTextMark[];
} {
  const { applied_terms, failed_terms } = partition_glossary_terms(item, draft_item); // 为什么：命中的术语要同时标亮原文和译文，未命中的术语只在原文保留警告提示，方便人工补齐
  const source_marks: AppTextMark[] = [];
  const translation_marks: AppTextMark[] = [];

  applied_terms.forEach((term) => {
    find_text_match_ranges(item.src, term[0]).forEach((range) => {
      source_marks.push({
        ...range,
        tone: "success",
        tooltip: `${t("proofreading_page.glossary.tooltip_applied")}\n${term[0]} -> ${term[1]}`,
      });
    });
    find_text_match_ranges(draft_item.dst, term[1]).forEach((range) => {
      translation_marks.push({
        ...range,
        tone: "success",
        tooltip: `${t("proofreading_page.glossary.tooltip_applied")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  failed_terms.forEach((term) => {
    find_text_match_ranges(item.src, term[0]).forEach((range) => {
      source_marks.push({
        ...range,
        tone: "warning",
        tooltip: `${t("proofreading_page.glossary.tooltip_failed")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  return {
    source_marks,
    translation_marks,
  };
}

function build_name_glossary_marks(args: {
  text: string;
  source_field: boolean;
  state: ProofreadingNameGlossaryState;
  t: ReturnType<typeof useI18n>["t"];
}): AppTextMark[] {
  const marks: AppTextMark[] = [];

  args.state.applied_terms.forEach((term) => {
    const fragment = args.source_field ? term[0] : term[1];
    find_text_match_ranges(args.text, fragment).forEach((range) => {
      marks.push({
        ...range,
        tone: "success",
        tooltip: `${args.t("proofreading_page.glossary.tooltip_applied")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  args.state.failed_terms.forEach((term) => {
    const fragment = args.source_field ? term[0] : term[1];
    find_text_match_ranges(args.text, fragment).forEach((range) => {
      marks.push({
        ...range,
        tone: "warning",
        tooltip: `${args.t("proofreading_page.glossary.tooltip_failed")}\n${term[0]} -> ${term[1]}`,
      });
    });
  });

  return marks;
}

/**
 * 解析当前场景的最终消费值。
 */
function resolve_glossary_badge_state(
  item: ProofreadingItem,
  draft_item: ProofreadingEditDialogProps["draft_item"],
  t: ReturnType<typeof useI18n>["t"],
): {
  label: string;
  tone: ProofreadingBadgeTone;
} | null {
  const { applied_terms, failed_terms } = partition_glossary_terms(item, draft_item);

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

function resolve_source_name_glossary_state(args: {
  source_name: string;
  applied_terms: ProofreadingGlossaryTerm[];
  failed_terms: ProofreadingGlossaryTerm[];
}): ProofreadingNameGlossaryState {
  const applied_terms = args.applied_terms.filter((term) => args.source_name.includes(term[0]));
  const failed_terms = args.failed_terms.filter((term) => args.source_name.includes(term[0]));
  return {
    tone: failed_terms.length > 0 ? "warning" : applied_terms.length > 0 ? "success" : "neutral",
    applied_terms,
    failed_terms,
  };
}

function resolve_translation_name_glossary_state(args: {
  source_name: string;
  translation_name: string;
  applied_terms: ProofreadingGlossaryTerm[];
  failed_terms: ProofreadingGlossaryTerm[];
}): ProofreadingNameGlossaryState {
  const terms = dedupe_glossary_terms([...args.applied_terms, ...args.failed_terms]).filter(
    (term) => {
      return args.source_name.includes(term[0]);
    },
  );
  const applied_terms = terms.filter((term) => args.translation_name.includes(term[1]));
  const failed_terms = terms.filter((term) => !args.translation_name.includes(term[1]));
  return {
    tone: failed_terms.length > 0 ? "warning" : applied_terms.length > 0 ? "success" : "neutral",
    applied_terms,
    failed_terms,
  };
}

function render_name_input_with_glossary_state(args: {
  input: JSX.Element;
  state: ProofreadingNameGlossaryState;
  t: ReturnType<typeof useI18n>["t"];
}): JSX.Element {
  const tooltip_content = render_glossary_tooltip_content(
    args.state.applied_terms,
    args.state.failed_terms,
    args.t,
  );
  if (tooltip_content === null) {
    return args.input;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="proofreading-page__dialog-name-tooltip-trigger">{args.input}</span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="proofreading-page__dialog-badge-tooltip"
      >
        {tooltip_content}
      </TooltipContent>
    </Tooltip>
  );
}
export function ProofreadingEditDialog(props: ProofreadingEditDialogProps): JSX.Element | null {
  const { t } = useI18n();
  const item = props.item;
  const save_label = t("proofreading_page.action.save");
  const save_disabled = props.readonly || props.saving;

  useActionShortcut({
    action: "save",
    enabled: props.open && !save_disabled,
    on_trigger: () => {
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
  const status_label = status_label_key === undefined ? item.status : t(status_label_key);
  const glossary_badge_state = resolve_glossary_badge_state(item, props.draft_item, t);
  const glossary_terms = partition_glossary_terms(item, props.draft_item);
  const glossary_tooltip_content = render_glossary_tooltip_content(
    glossary_terms.applied_terms,
    glossary_terms.failed_terms,
    t,
  );
  const { source_marks, translation_marks } = build_glossary_highlights(item, props.draft_item, t);
  const visible_warning_codes =
    glossary_badge_state === null
      ? item.warnings
      : item.warnings.filter((warning) => warning !== "GLOSSARY");
  const source_name = read_item_name_text(item.name_src);
  const translation_name = props.draft_item.name_dst;
  const source_name_glossary_state = resolve_source_name_glossary_state({
    source_name,
    applied_terms: glossary_terms.applied_terms,
    failed_terms: glossary_terms.failed_terms,
  });
  const translation_name_glossary_state = resolve_translation_name_glossary_state({
    source_name,
    translation_name,
    applied_terms: glossary_terms.applied_terms,
    failed_terms: glossary_terms.failed_terms,
  });
  const show_name_fields =
    read_optional_item_name_text(item.name_src) !== null ||
    read_optional_item_name_text(item.name_dst) !== null ||
    translation_name !== "";
  const translation_readonly = props.readonly || props.saving;
  const source_name_marks = build_name_glossary_marks({
    text: source_name,
    source_field: true,
    state: source_name_glossary_state,
    t,
  });
  const translation_name_marks = build_name_glossary_marks({
    text: translation_name,
    source_field: false,
    state: translation_name_glossary_state,
    t,
  });

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
            <AppButton
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
            </AppButton>
            <AppButton
              type="button"
              variant="outline"
              size="sm"
              disabled={props.readonly || props.saving}
              onClick={() => {
                props.on_request_clear_translation([String(item.item_id)]);
              }}
            >
              <Eraser data-icon="inline-start" />
              {t("proofreading_page.action.clear_translation")}
            </AppButton>
            <AppDropdownMenu>
              <AppDropdownMenuTrigger asChild>
                <AppButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={props.readonly || props.saving}
                >
                  <ListChecks data-icon="inline-start" />
                  {t("proofreading_page.action.set_translation_status")}
                </AppButton>
              </AppDropdownMenuTrigger>
              <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
                <AppDropdownMenuGroup>
                  {PROOFREADING_MANUAL_STATUS_CODES.map((status) => (
                    <AppDropdownMenuItem
                      key={status}
                      onSelect={() => {
                        props.on_request_set_translation_status([String(item.item_id)], status);
                      }}
                    >
                      {t(PROOFREADING_STATUS_LABEL_KEY_BY_CODE[status])}
                    </AppDropdownMenuItem>
                  ))}
                </AppDropdownMenuGroup>
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AppButton
              type="button"
              variant="outline"
              size="sm"
              disabled={props.saving}
              onClick={props.on_close}
            >
              {t("proofreading_page.action.cancel")}
            </AppButton>
            <AppButton
              type="button"
              size="sm"
              disabled={save_disabled}
              onClick={() => {
                void props.on_save();
              }}
            >
              {save_label}
              <ShortcutKbd action="save" className="bg-background/18 text-primary-foreground" />
            </AppButton>
          </div>
        </>
      }
    >
      <div className="proofreading-page__dialog-scroll">
        <div className="proofreading-page__dialog-form">
          <div className="proofreading-page__dialog-main-panel">
            <div className="proofreading-page__dialog-main-panel-content">
              <section className="proofreading-page__dialog-file-card">
                <span className="proofreading-page__dialog-file-path">{item.file_path}</span>
              </section>

              <section className="proofreading-page__dialog-editor-block">
                <section className="proofreading-page__dialog-editor-section">
                  <span className="proofreading-page__dialog-editor-title font-medium">
                    {t("proofreading_page.fields.source")}
                  </span>
                  {show_name_fields
                    ? render_name_input_with_glossary_state({
                        input: (
                          <AppEditor
                            variant="field"
                            class_name="proofreading-page__dialog-name-input"
                            value={source_name}
                            aria_label={t("proofreading_page.fields.source_name")}
                            aria_invalid={source_name_glossary_state.tone === "warning"}
                            marks={source_name_marks}
                            read_only
                          />
                        ),
                        state: source_name_glossary_state,
                        t,
                      })
                    : null}
                  <AppEditor
                    value={item.src}
                    aria_label={t("proofreading_page.fields.source")}
                    read_only={true}
                    marks={source_marks}
                    class_name="proofreading-page__dialog-editor-host"
                  />
                </section>

                <section className="proofreading-page__dialog-editor-section">
                  <span className="proofreading-page__dialog-editor-title font-medium">
                    {t("proofreading_page.fields.translation")}
                  </span>
                  {show_name_fields
                    ? render_name_input_with_glossary_state({
                        input: (
                          <AppEditor
                            variant="field"
                            class_name="proofreading-page__dialog-name-input"
                            value={translation_name}
                            aria_label={t("proofreading_page.fields.translation_name")}
                            aria_invalid={translation_name_glossary_state.tone === "warning"}
                            marks={translation_name_marks}
                            read_only={translation_readonly}
                            on_change={(next_value) => {
                              props.on_change({ name_dst: next_value });
                            }}
                          />
                        ),
                        state: translation_name_glossary_state,
                        t,
                      })
                    : null}
                  <AppEditor
                    value={props.draft_item.dst}
                    aria_label={t("proofreading_page.fields.translation")}
                    read_only={translation_readonly}
                    marks={translation_marks}
                    class_name="proofreading-page__dialog-editor-host"
                    on_change={(next_value) => {
                      props.on_change({ dst: next_value });
                    }}
                  />
                </section>
              </section>

              <section className="proofreading-page__dialog-status-section">
                <h3 className="proofreading-page__dialog-status-title font-medium">
                  {t("proofreading_page.fields.status")}
                </h3>
                <div className="proofreading-page__dialog-status-strip">
                  {render_status_badge({
                    label: status_label,
                    tone: status_badge_tone,
                  })}
                  {glossary_badge_state === null
                    ? null
                    : render_status_badge({
                        label: glossary_badge_state.label,
                        tone: glossary_badge_state.tone,
                        tooltip_content: glossary_tooltip_content,
                      })}
                  {visible_warning_codes.map((warning) => {
                    const label_key =
                      PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                        warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                      ];
                    const warning_tooltip_content = render_warning_tooltip_content(
                      item,
                      warning,
                      t,
                    );
                    return (
                      <span key={warning} className="proofreading-page__dialog-status-badge-wrap">
                        {render_status_badge({
                          label: label_key === undefined ? warning : t(label_key),
                          tone: resolve_warning_badge_tone(),
                          tooltip_content: warning_tooltip_content,
                        })}
                      </span>
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
