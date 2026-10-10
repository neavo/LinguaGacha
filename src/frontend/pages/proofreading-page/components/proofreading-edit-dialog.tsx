import { ProofreadingDetailLayout } from "./proofreading-detail-layout";
import { type JSX, useEffect, useRef } from "react";
import { BookOpenText, Braces, Eraser, ListChecks, RefreshCcw } from "lucide-react";

import { ITEM_MANUAL_STATUSES, type ItemManualStatus } from "@domain/item";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
} from "@frontend/features/proofreading/proofreading-label-keys";
import { ProofreadingContextView } from "@frontend/pages/proofreading-page/components/proofreading-context-view";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import type { AppTextMark } from "@frontend/widgets/app-editor/app-editor-code-mirror";
import {
  format_proofreading_glossary_term,
  read_proofreading_warning_codes,
  type ProofreadingWarningCode,
  type ProofreadingItem,
} from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppContentState } from "@frontend/widgets/app-content-state";
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
  compile_glossary,
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
  on_open_view: (kind: "context" | "raw-data") => Promise<void>;
  on_return_to_edit: () => void;
  on_open_context_item: (row_id: string) => Promise<void>;
  on_request_retranslate: (row_ids: string[]) => void;
  on_request_clear_translation: (row_ids: string[]) => void;
  on_request_set_translation_status: (row_ids: string[], status: ItemManualStatus) => void;
};

type ProofreadingBadgeTone = "neutral" | "success" | "warning" | "failure";

type ProofreadingNameGlossaryState = {
  tone: "neutral" | "success" | "warning";
  applications: GlossaryApplication[];
};

/** 翻译状态只突出成功与失败，未处理和跳过沿用中性色。 */
function resolve_status_badge_tone(status: string): ProofreadingBadgeTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

/** 空片段不占提示区，保留可复制的逐条正文。 */
function render_fragment_section(title: string | null, fragments: string[]): JSX.Element | null {
  if (fragments.length === 0) {
    return null;
  }

  return (
    <section className="proofreading-page__dialog-badge-tooltip-section">
      {title === null ? null : (
        <p className="proofreading-page__dialog-badge-tooltip-title font-medium">{title}</p>
      )}
      <ul className="proofreading-page__dialog-badge-tooltip-list">
        {fragments.map((fragment, index) => (
          <li key={index} className="proofreading-page__dialog-badge-tooltip-item">
            {fragment}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 对照提示统一按原文、译文分组；空侧省略，双方为空时不建立提示。 */
function render_comparison_tooltip(
  source: string[],
  translation: string[],
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  if (source.length === 0 && translation.length === 0) return null;
  return (
    <div className="proofreading-page__dialog-badge-tooltip-copy">
      {render_fragment_section(t("proofreading_page.fields.source"), source)}
      {render_fragment_section(t("proofreading_page.fields.translation"), translation)}
    </div>
  );
}

/** 提示直接按当前字段应用事实分组，独立于条目警告和胶囊状态。 */
function render_glossary_tooltip_content(
  applications: GlossaryApplication[],
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  if (applications.length === 0) return null;
  const failed: string[] = [];
  const applied: string[] = [];
  // 应用结果已按 entry_id 汇总全部命中字段，任一字段缺失即归入未落实组。
  for (const application of applications) {
    const target = application.fields.some((field) => !field.applied) ? failed : applied;
    target.push(format_proofreading_glossary_term(application));
  }
  return (
    <div className="proofreading-page__dialog-badge-tooltip-copy">
      {render_fragment_section(t("proofreading_page.glossary.missing"), failed)}
      {render_fragment_section(t("proofreading_page.glossary.applied"), applied)}
    </div>
  );
}

/** 提示只展示合并后的具体证据，没有目标条目的规则仅显示胶囊。 */
function render_warning_tooltip_content(
  item: ProofreadingItem,
  code: ProofreadingWarningCode,
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element | null {
  if (code === "FOREIGN_CHAR_RESIDUE") {
    const fragments = item.warnings.flatMap((warning) =>
      warning.code === code ? warning.fragments : [],
    );
    return render_fragment_section(null, [...new Set(fragments)]);
  }
  if (code === "TEXT_PRESERVE") {
    const warnings = item.warnings.filter((warning) => warning.code === code);
    return render_comparison_tooltip(
      [...new Set(warnings.flatMap((warning) => warning.source_fragments))],
      [...new Set(warnings.flatMap((warning) => warning.translation_fragments))],
      t,
    );
  }
  return null;
}

/** 有详情时组合提示，无详情时直接显示状态胶囊。 */
function render_status_badge(args: {
  label: string;
  tone: ProofreadingBadgeTone;
  tooltip_content?: JSX.Element | null;
}): JSX.Element {
  const badge = <Badge tone={args.tone}>{args.label}</Badge>;

  if (args.tooltip_content === null || args.tooltip_content === undefined) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent align="start" className="proofreading-page__dialog-badge-tooltip">
        {args.tooltip_content}
      </TooltipContent>
    </Tooltip>
  );
}

/** 匹配文本采用编辑器的 LF 换行，使高亮偏移与显示正文一致。 */
function normalize_code_editor_match_text(text: string): string {
  return text.replace(/\r\n|\r/gu, "\n");
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
      })),
    }),
  );
  return evaluate_glossary_applications(
    compile_glossary(source_matches.map((match) => match.entry)),
    source_matches,
    read_item_translation_text_parts({ dst: draft_item.dst, name_dst: draft_item.name_dst }),
  );
}

/** 按当前源或目标字段匹配术语，生成编辑器高亮与对应提示。 */
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
    return match.ranges.map((range) => ({
      ...range,
      tone: applied ? ("success" as const) : ("warning" as const),
      tooltip: `${args.t(applied ? "proofreading_page.glossary.applied" : "proofreading_page.glossary.missing")}\n${format_proofreading_glossary_term(application)}`,
    }));
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
    applications: name_applications.map((application) => ({
      ...application,
      fields: application.fields.filter((field) => field.source_field === "name_src"),
    })),
  };
}

/** 姓名输入框只在存在姓名术语结果时附加详情提示。 */
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
      <TooltipTrigger
        render={
          <span className="proofreading-page__dialog-name-tooltip-trigger">{args.input}</span>
        }
      />
      <TooltipContent align="start" className="proofreading-page__dialog-badge-tooltip">
        {tooltip_content}
      </TooltipContent>
    </Tooltip>
  );
}

/** 校对条目弹窗组合编辑、前后文和原始数据查看，共用返回行为。 */
export function ProofreadingEditDialog(props: ProofreadingEditDialogProps): JSX.Element | null {
  const { t } = useI18n();
  const item = props.item;
  const { view, draft_item, open, pending } = props.state;
  const viewer_open = view.kind !== "edit";
  const context_trigger_ref = useRef<HTMLButtonElement>(null);
  const raw_data_trigger_ref = useRef<HTMLButtonElement>(null);
  const previous_view_ref = useRef(view.kind); // 返回编辑时用原视图恢复对应入口的焦点。
  const save_label = t("app.action.save");
  const has_content_change =
    item !== null &&
    (draft_item.dst !== item.dst || draft_item.name_dst !== read_item_name_text(item.name_dst));
  const save_disabled = props.readonly || pending || !has_content_change;

  useEffect(() => {
    if (previous_view_ref.current !== "edit" && !viewer_open && open) {
      const trigger =
        previous_view_ref.current === "context" ? context_trigger_ref : raw_data_trigger_ref;
      trigger.current?.focus();
    }
    previous_view_ref.current = view.kind;
  }, [view.kind, viewer_open, open]);

  useActionShortcut({
    action: "save",
    enabled: open && !viewer_open && !save_disabled,
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
  const source_marks = build_glossary_field_marks({
    text: item.src,
    applications: glossary_applications,
    field: "src",
    t,
  });
  const translation_marks = build_glossary_field_marks({
    text: draft_item.dst,
    applications: glossary_applications,
    field: "dst",
    t,
  });
  const visible_warning_codes = read_proofreading_warning_codes(item.warnings).filter(
    (code) => glossary_badge_state === null || code !== "GLOSSARY",
  );
  const source_name = read_item_name_text(item.name_src);
  const translation_name = draft_item.name_dst;
  const file_path_label =
    item.internal_file_path === null
      ? item.file_path
      : `${item.file_path} | ${item.internal_file_path}`;
  const name_glossary_state = resolve_name_glossary_state(glossary_applications); // 双方姓名共享当前草稿的落实结果。
  const show_name_fields =
    read_optional_item_name_text(item.name_src) !== null ||
    read_optional_item_name_text(item.name_dst) !== null ||
    translation_name !== "";
  const translation_readonly = props.readonly || pending;
  const source_name_marks = build_glossary_field_marks({
    text: source_name,
    applications: name_glossary_state.applications,
    field: "name_src",
    t,
  });
  const translation_name_marks = build_glossary_field_marks({
    text: translation_name,
    applications: name_glossary_state.applications,
    field: "name_dst",
    t,
  });

  return (
    <AppPageDialog
      open={open}
      title={t(
        view.kind === "context"
          ? "proofreading_page.action.view_context"
          : view.kind === "raw-data"
            ? "proofreading_page.action.raw_data"
            : "app.action.edit",
      )}
      size="viewport"
      dismissBehavior={pending ? "blocked" : viewer_open ? "default" : "escape-only"}
      onClose={viewer_open ? props.on_return_to_edit : props.on_close}
      bodyClassName="overflow-hidden p-0"
      footerClassName={viewer_open ? undefined : "sm:justify-between"}
      footer={
        viewer_open ? (
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            autoFocus
            disabled={pending}
            onClick={props.on_return_to_edit}
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
                disabled={props.readonly || pending}
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
                disabled={props.readonly || pending}
                onClick={() => {
                  props.on_request_clear_translation([String(item.item_id)]);
                }}
              >
                <Eraser data-icon="inline-start" />
                {t("proofreading_page.action.clear_translation")}
              </AppButton>
              <AppDropdownMenu>
                <AppDropdownMenuTrigger
                  render={
                    <AppButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={props.readonly || pending}
                    >
                      <ListChecks data-icon="inline-start" />
                      {t("proofreading_page.action.set_translation_status")}
                    </AppButton>
                  }
                />
                <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
                  <AppDropdownMenuGroup>
                    {ITEM_MANUAL_STATUSES.map((status) => (
                      <AppDropdownMenuItem
                        key={status}
                        onClick={() => {
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
                disabled={pending}
                onClick={props.on_close}
              >
                {t("app.action.cancel")}
                <ShortcutKbd action="cancel" />
              </AppButton>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <AppButton
                      type="button"
                      size="sm"
                      disabled={save_disabled}
                      onClick={() => {
                        void props.on_save();
                      }}
                    >
                      {save_label}
                      <ShortcutKbd
                        action="save"
                        className="bg-background/18 text-primary-foreground"
                      />
                    </AppButton>
                  }
                />
                <TooltipContent>
                  {t("proofreading_page.tooltip.save_translation_status")}
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        )
      }
    >
      <div className="proofreading-page__dialog-scroll">
        {view.kind !== "edit" && view.status !== "ready" ? (
          <div className="proofreading-page__dialog-view-state">
            <AppContentState
              status={view.status}
              message={t(
                view.kind === "context"
                  ? "proofreading_page.context.loading"
                  : "proofreading_page.raw_data.loading",
              )}
            />
          </div>
        ) : view.kind === "context" && view.status === "ready" ? (
          <ProofreadingContextView
            items={view.items}
            target_row_id={String(item.item_id)}
            draft_item={draft_item}
            disabled={pending || props.readonly}
            on_open_item={props.on_open_context_item}
          />
        ) : view.kind === "raw-data" && view.status === "ready" ? (
          <AppEditor
            variant="viewer"
            syntax="json"
            value={view.text}
            aria_label={t("proofreading_page.action.raw_data")}
            class_name="proofreading-page__dialog-editor-host"
          />
        ) : null}
        {/* 编辑区持续挂载，查看时只隐藏，保留选区和阅读位置。 */}
        <ProofreadingDetailLayout
          hidden={viewer_open}
          file_label={file_path_label}
          file_actions={
            <div className="proofreading-page__dialog-file-actions">
              <AppButton
                ref={context_trigger_ref}
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void props.on_open_view("context");
                }}
              >
                <BookOpenText data-icon="inline-start" />
                {t("proofreading_page.action.view_context")}
              </AppButton>
              <AppButton
                ref={raw_data_trigger_ref}
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void props.on_open_view("raw-data");
                }}
              >
                <Braces data-icon="inline-start" />
                {t("proofreading_page.action.raw_data")}
              </AppButton>
            </div>
          }
          source={
            <>
              {show_name_fields
                ? render_name_input_with_glossary_state({
                    input: (
                      <AppEditor
                        variant="field"
                        class_name="proofreading-page__dialog-name-input"
                        value={source_name}
                        aria_label={t("proofreading_page.fields.source")}
                        aria_invalid={name_glossary_state.tone === "warning"}
                        marks={source_name_marks}
                        read_only
                      />
                    ),
                    state: name_glossary_state,
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
            </>
          }
          translation={
            <>
              {show_name_fields
                ? render_name_input_with_glossary_state({
                    input: (
                      <AppEditor
                        variant="field"
                        class_name="proofreading-page__dialog-name-input"
                        value={translation_name}
                        aria_label={t("proofreading_page.fields.translation")}
                        aria_invalid={name_glossary_state.tone === "warning"}
                        marks={translation_name_marks}
                        read_only={translation_readonly}
                        on_change={(next_value) => {
                          props.on_change({ name_dst: next_value });
                        }}
                      />
                    ),
                    state: name_glossary_state,
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
            </>
          }
        >
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
        </ProofreadingDetailLayout>
      </div>
    </AppPageDialog>
  );
}
