import { useEffect, useRef } from "react";
import { BookOpenText, Eraser, ListChecks, RefreshCcw } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { ProofreadingContextView } from "@frontend/pages/proofreading-page/components/proofreading-context-view";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import type { AppTextMark } from "@frontend/widgets/app-editor/app-editor-code-mirror";
import {
  format_proofreading_glossary_term,
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
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
import {
  evaluate_glossary_applications,
  resolve_glossary_application_state,
  type GlossaryApplication,
  type GlossarySourceMatch,
} from "@shared/quality/glossary";
import { read_item_translation_text_parts } from "@shared/item-text";
import { compile_literal_patterns } from "@shared/text/literal-matcher";

type ProofreadingEditDialogProps = {
  state: ProofreadingDialogState;
  item: ProofreadingItem | null;
  readonly: boolean;
  on_change: (patch: Partial<ProofreadingDialogState["draft_item"]>) => void;
  on_save: () => Promise<void>;
  on_close: () => void;
  on_open_context: () => Promise<void>;
  on_close_context: () => void;
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
  applications: GlossaryApplication[];
};

function resolve_status_badge_tone(status: string): ProofreadingBadgeTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

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

function render_glossary_tooltip_content(
  applications: GlossaryApplication[],
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  const { applied, failed } = split_glossary_applications(applications);
  if (applied.length === 0 && failed.length === 0) {
    return null;
  }

  return (
    <div className="proofreading-page__dialog-badge-tooltip-copy">
      {render_fragment_section(
        t("proofreading_page.tooltip.glossary_applied_terms"),
        applied.map(format_proofreading_glossary_term),
      )}
      {render_fragment_section(
        t("proofreading_page.tooltip.glossary_missing_terms"),
        failed.map(format_proofreading_glossary_term),
      )}
    </div>
  );
}

/** 将有具体片段的警告映射为可复制的 tooltip 内容。 */
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

function render_status_badge(args: {
  label: string;
  tone: ProofreadingBadgeTone;
  tooltip_content?: JSX.Element | null;
}): JSX.Element {
  const class_name = [
    "proofreading-page__dialog-status-badge",
    `proofreading-page__dialog-status-badge--tone-${args.tone}`,
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

function normalize_code_editor_match_text(text: string): string {
  return text.replace(/\r\n|\r/gu, "\n");
}

function split_glossary_applications(applications: GlossaryApplication[]): {
  applied: GlossaryApplication[];
  failed: GlossaryApplication[];
} {
  return {
    applied: applications.filter((application) =>
      application.fields.every((field) => field.applied),
    ),
    failed: applications.filter((application) =>
      application.fields.some((field) => !field.applied),
    ),
  };
}

/** 编辑窗沿用后端已锁定的源字段集合，只对草稿目标字段重新求值。 */
function evaluate_draft_glossary_applications(
  item: ProofreadingItem,
  draft_item: ProofreadingDialogState["draft_item"],
): GlossaryApplication[] {
  const source_matches: GlossarySourceMatch[] = item.glossary_applications.map(
    ({ entry_id, src, dst, case_sensitive, fields }) => ({
      entry: { entry_id, src, dst, case_sensitive, info: "" },
      fields: fields.map(({ source_field, target_field }) => ({
        source_field,
        target_field,
        ranges: [],
      })),
    }),
  );
  return evaluate_glossary_applications(
    source_matches,
    read_item_translation_text_parts({ dst: draft_item.dst, name_dst: draft_item.name_dst }),
  );
}

function build_glossary_field_marks(args: {
  text: string;
  applications: GlossaryApplication[];
  field: "src" | "name_src" | "dst" | "name_dst";
  t: ReturnType<typeof useI18n>["t"];
}): AppTextMark[] {
  const source_field = args.field === "src" || args.field === "name_src";
  const applications = args.applications.filter((application) =>
    application.fields.some((field) =>
      source_field ? field.source_field === args.field : field.target_field === args.field,
    ),
  );
  const matcher = compile_literal_patterns(
    applications.map((application) => ({
      key: application.entry_id,
      text: source_field ? application.src : application.dst,
      case_sensitive: source_field ? application.case_sensitive : true,
    })),
  );
  const application_by_id = new Map(
    applications.map((application) => [application.entry_id, application]),
  );
  return matcher.match(normalize_code_editor_match_text(args.text)).flatMap((match) => {
    const application = application_by_id.get(match.key);
    if (application === undefined) return [];
    const applied = application.fields
      .filter((field) =>
        source_field ? field.source_field === args.field : field.target_field === args.field,
      )
      .every((field) => field.applied);
    if (!source_field && !applied) return [];
    const label = format_proofreading_glossary_term(application);
    return match.ranges.map((range) => ({
      ...range,
      tone: applied ? ("success" as const) : ("warning" as const),
      tooltip: `${args.t(
        applied
          ? "proofreading_page.glossary.tooltip_applied"
          : "proofreading_page.glossary.tooltip_missing",
      )}\n${label}`,
    }));
  });
}

/** 命中术语标亮双语文本，缺失译文的术语只警示原文。 */
function build_glossary_highlights(
  item: ProofreadingItem,
  draft_item: ProofreadingDialogState["draft_item"],
  applications: GlossaryApplication[],
  t: ReturnType<typeof useI18n>["t"],
): {
  source_marks: AppTextMark[];
  translation_marks: AppTextMark[];
} {
  return {
    source_marks: build_glossary_field_marks({ text: item.src, applications, field: "src", t }),
    translation_marks: build_glossary_field_marks({
      text: draft_item.dst,
      applications,
      field: "dst",
      t,
    }),
  };
}

/** 按姓名字段所在语言选择术语侧，生成与正文一致的标亮语义。 */
function build_name_glossary_marks(args: {
  text: string;
  source_field: boolean;
  state: ProofreadingNameGlossaryState;
  t: ReturnType<typeof useI18n>["t"];
}): AppTextMark[] {
  return build_glossary_field_marks({
    text: args.text,
    applications: args.state.applications,
    field: args.source_field ? "name_src" : "name_dst",
    t: args.t,
  });
}

/** 将当前草稿术语命中情况归纳为成功、部分或失败胶囊。 */
function resolve_glossary_badge_state(
  applications: GlossaryApplication[],
  t: ReturnType<typeof useI18n>["t"],
): {
  label: string;
  tone: ProofreadingBadgeTone;
} | null {
  const state = resolve_glossary_application_state(applications);
  if (state === "none") {
    return null;
  }

  if (state === "applied") {
    return {
      label: t("proofreading_page.glossary.applied"),
      tone: "success",
    };
  }

  if (state === "missing") {
    return {
      label: t("proofreading_page.glossary.missing"),
      tone: "failure",
    };
  }

  return {
    label: t("proofreading_page.glossary.partial"),
    tone: "warning",
  };
}

/** 原文姓名只消费源词命中，避免正文中的同词污染姓名状态。 */
function resolve_name_glossary_state(
  applications: GlossaryApplication[],
): ProofreadingNameGlossaryState {
  const name_applications = applications.filter((application) =>
    application.fields.some((field) => field.source_field === "name_src"),
  );
  const has_failed = name_applications.some((application) =>
    application.fields.some((field) => field.source_field === "name_src" && !field.applied),
  );
  return {
    tone: has_failed ? "warning" : name_applications.length > 0 ? "success" : "neutral",
    applications: name_applications,
  };
}

function render_name_input_with_glossary_state(args: {
  input: JSX.Element;
  state: ProofreadingNameGlossaryState;
  t: ReturnType<typeof useI18n>["t"];
}): JSX.Element {
  const tooltip_content = render_glossary_tooltip_content(args.state.applications, args.t);
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

/** 校对编辑弹窗组合文件详情、双栏编辑、状态操作与同文件上下文。 */
export function ProofreadingEditDialog(props: ProofreadingEditDialogProps): JSX.Element | null {
  const { t } = useI18n();
  const item = props.item;
  const { context, draft_item, open, saving } = props.state;
  const context_open = context.status !== "idle";
  const context_trigger_ref = useRef<HTMLButtonElement>(null);
  const previous_context_open_ref = useRef(false);
  const save_label = t("proofreading_page.action.save");
  const save_disabled = props.readonly || saving;

  useEffect(() => {
    if (previous_context_open_ref.current && !context_open && open) {
      context_trigger_ref.current?.focus();
    }
    previous_context_open_ref.current = context_open;
  }, [context_open, open]);

  useActionShortcut({
    action: "save",
    enabled: open && !context_open && !save_disabled,
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
  const glossary_applications = evaluate_draft_glossary_applications(item, draft_item);
  const glossary_badge_state = resolve_glossary_badge_state(glossary_applications, t);
  const glossary_tooltip_content = render_glossary_tooltip_content(glossary_applications, t);
  const { source_marks, translation_marks } = build_glossary_highlights(
    item,
    draft_item,
    glossary_applications,
    t,
  );
  const visible_warning_codes =
    glossary_badge_state === null
      ? item.warnings
      : item.warnings.filter((warning) => warning !== "GLOSSARY");
  const source_name = read_item_name_text(item.name_src);
  const translation_name = draft_item.name_dst;
  const file_path_label =
    item.internal_file_path === undefined
      ? item.file_path
      : `${item.file_path} | ${item.internal_file_path}`;
  const source_name_glossary_state = resolve_name_glossary_state(glossary_applications);
  const translation_name_glossary_state = source_name_glossary_state;
  const show_name_fields =
    read_optional_item_name_text(item.name_src) !== null ||
    read_optional_item_name_text(item.name_dst) !== null ||
    translation_name !== "";
  const translation_readonly = props.readonly || saving;
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
      open={open}
      title={t(
        context_open ? "proofreading_page.action.view_context" : "proofreading_page.action.edit",
      )}
      size="lg"
      dismissBehavior={context_open ? "default" : saving ? "blocked" : "escape-only"}
      onClose={context_open ? props.on_close_context : props.on_close}
      bodyClassName="overflow-hidden p-0"
      footerClassName={context_open ? undefined : "sm:justify-between"}
      footer={
        context_open ? (
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            autoFocus
            onClick={props.on_close_context}
          >
            {t("proofreading_page.action.back")}
            <ShortcutKbd action="cancel" />
          </AppButton>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                disabled={props.readonly || saving}
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
                disabled={props.readonly || saving}
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
                    disabled={props.readonly || saving}
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
                disabled={saving}
                onClick={props.on_close}
              >
                {t("proofreading_page.action.cancel")}
                <ShortcutKbd action="cancel" />
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
        )
      }
    >
      <div className="proofreading-page__dialog-scroll">
        {context_open ? (
          <ProofreadingContextView
            state={context}
            target_row_id={String(item.item_id)}
            file_path={item.file_path}
            draft_item={draft_item}
            on_retry={() => {
              void props.on_open_context();
            }}
          />
        ) : null}
        <div className="proofreading-page__dialog-form" hidden={context_open}>
          <section className="proofreading-page__dialog-file-card">
            <span className="proofreading-page__dialog-file-path" title={file_path_label}>
              {file_path_label}
            </span>
            <AppButton
              ref={context_trigger_ref}
              type="button"
              variant="ghost"
              size="sm"
              className="proofreading-page__dialog-context-trigger"
              disabled={saving}
              onClick={() => {
                void props.on_open_context();
              }}
            >
              <BookOpenText data-icon="inline-start" />
              {t("proofreading_page.action.view_context")}
            </AppButton>
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
                value={draft_item.dst}
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
                const warning_tooltip_content = render_warning_tooltip_content(item, warning, t);
                return (
                  <span key={warning} className="proofreading-page__dialog-status-badge-wrap">
                    {render_status_badge({
                      label: label_key === undefined ? warning : t(label_key),
                      tone: "warning",
                      tooltip_content: warning_tooltip_content,
                    })}
                  </span>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </AppPageDialog>
  );
}
