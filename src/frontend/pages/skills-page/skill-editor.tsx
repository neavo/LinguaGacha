import { AGENT_SKILL_MAIN_FILE } from "@shared/agent-skills";
import { Fragment, useEffect, useState, type CSSProperties, type ClipboardEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { AppButton } from "@frontend/widgets/app-button";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { Card } from "@frontend/shadcn/card";
import { CommandBar } from "@frontend/widgets/command-bar/command-bar";
import { Badge } from "@frontend/shadcn/badge";
import { Input } from "@frontend/shadcn/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import type { AgentSkillIdentity } from "@shared/agent-skills";
import { SkillFileTree } from "./skill-file-tree";
import { useSkillEditor } from "./use-skill-editor";
import "./skill-editor.css";

const TREE_WIDTH = { initial: 196, min: 180, max: 480, step: 20 };

/** 组合技能导航、元数据表单与正文，并将自动保存接入离页流程。 */
export function SkillEditor({
  skill,
  on_back,
}: {
  skill: AgentSkillIdentity;
  on_back: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const editor = useSkillEditor(skill);
  const { leaving, register_before_leave } = usePageLeave();
  const [width, set_width] = useState(TREE_WIDTH.initial);
  useEffect(() => register_before_leave(editor.flush), [editor.flush, register_before_leave]);
  const readonly = skill.source === "builtin";
  const locked = readonly || editor.busy || leaving;
  const status = editor.error
    ? "failed"
    : editor.invalid
      ? "invalid"
      : editor.saving
        ? "saving"
        : editor.dirty
          ? "modified"
          : "saved";
  const document = editor.draft.document;
  const path_parts = [
    editor.file?.skill.name ?? skill.name,
    ...(editor.file?.path ?? AGENT_SKILL_MAIN_FILE).split("/"),
  ];
  const path_label = path_parts.join(" / ");
  /** 粘贴多行内容时替换换行，保持单行元数据输入契约。 */
  function paste_single_line(
    event: ClipboardEvent<HTMLInputElement>,
    field: "name" | "description",
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(text) || !document || locked) return;
    event.preventDefault();
    const input = event.currentTarget;
    const next =
      input.value.slice(0, input.selectionStart ?? 0) +
      text.replace(/[\r\n]+/g, " ") +
      input.value.slice(input.selectionEnd ?? input.value.length);
    editor.edit({ ...editor.draft, document: { ...document, [field]: next } });
  }
  return (
    <section
      className="skill-editor"
      style={{ "--skill-tree-width": `${width}px` } as CSSProperties}
      onCompositionStart={() => editor.compose(true)}
      onCompositionEnd={() => editor.compose(false)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (!locked) void editor.flush();
        }
      }}
    >
      <CommandBar
        className="skill-editor__toolbar"
        actions={
          <div className="skill-editor__toolbar-start">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  disabled={editor.busy || leaving}
                  aria-label={t("skills_page.editor.back")}
                  onClick={() => {
                    void editor.flush().then((ok) => {
                      if (ok) on_back();
                    });
                  }}
                >
                  <ChevronLeft />
                </AppButton>
              </TooltipTrigger>
              <TooltipContent>{t("skills_page.editor.back")}</TooltipContent>
            </Tooltip>
            <span className="skill-editor__path" title={path_label}>
              {path_parts.map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && <span className="skill-editor__path-separator">/</span>}
                  <span
                    className="skill-editor__path-segment"
                    data-directory={(index > 0 && index < path_parts.length - 1) || undefined}
                  >
                    {part}
                  </span>
                </Fragment>
              ))}
            </span>
          </div>
        }
        hint={
          !readonly && editor.file ? (
            <Badge
              tone={
                status === "failed"
                  ? "failure"
                  : status === "modified" || status === "invalid"
                    ? "warning"
                    : "neutral"
              }
            >
              {t(`skills_page.editor.${status}`)}
            </Badge>
          ) : undefined
        }
      />
      {editor.loading || !editor.tree || !editor.file ? (
        <Card className="skill-editor__state">
          <AppContentState
            status={editor.loading ? "loading" : "error"}
            message={
              editor.loading
                ? t("app.action.loading")
                : editor.error || t("skills_page.feedback.load_failed")
            }
            on_retry={() => {
              void editor.reload();
            }}
          />
        </Card>
      ) : (
        <div className="skill-editor__workspace">
          <Card render={<aside />} className="skill-editor__tree">
            <SkillFileTree
              entries={editor.tree.entries}
              path={editor.file.path}
              readonly={readonly}
              busy={editor.busy || leaving}
              on_open={editor.open_file}
              on_change={editor.change_file}
            />
          </Card>
          <div
            className="skill-editor__divider"
            role="separator"
            tabIndex={0}
            aria-label={t("skills_page.editor.files")}
            aria-orientation="vertical"
            aria-valuemin={TREE_WIDTH.min}
            aria-valuemax={TREE_WIDTH.max}
            aria-valuenow={width}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
                set_width(Math.max(TREE_WIDTH.min, Math.min(TREE_WIDTH.max, event.clientX - left)));
              }
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                set_width((value) =>
                  Math.max(
                    TREE_WIDTH.min,
                    Math.min(
                      TREE_WIDTH.max,
                      value + (event.key === "ArrowLeft" ? -TREE_WIDTH.step : TREE_WIDTH.step),
                    ),
                  ),
                );
              }
            }}
          />
          <Card className="skill-editor__content" data-readonly={readonly || undefined}>
            {editor.error && (
              <div className="skill-editor__error" role="alert">
                <span>{editor.conflict ? t("skills_page.editor.conflict") : editor.error}</span>
                <div>
                  <AppButton
                    size="sm"
                    variant="outline"
                    disabled={editor.busy || editor.saving}
                    onClick={() => {
                      void editor.flush();
                    }}
                  >
                    {t("app.action.retry")}
                  </AppButton>
                  <AppButton
                    size="sm"
                    variant="ghost"
                    disabled={editor.busy || editor.saving}
                    onClick={() => {
                      void editor.recover();
                    }}
                  >
                    {t("skills_page.editor.discard")}
                  </AppButton>
                  {editor.conflict && (
                    <AppButton
                      size="sm"
                      variant="outline"
                      disabled={editor.busy || editor.saving}
                      onClick={() => {
                        void editor.recover(true);
                      }}
                    >
                      {t("skills_page.editor.overwrite")}
                    </AppButton>
                  )}
                </div>
              </div>
            )}
            {editor.invalid && !readonly && (
              <div className="skill-editor__error">
                <AppButton
                  size="sm"
                  variant="ghost"
                  disabled={editor.busy || editor.saving}
                  onClick={() => {
                    void editor.recover();
                  }}
                >
                  {t("skills_page.editor.discard")}
                </AppButton>
              </div>
            )}
            {document && (
              <div className="skill-editor__metadata">
                {(["name", "description"] as const).map((field) => (
                  <label key={field}>
                    <span>{t(`skills_page.editor.${field}`)}</span>
                    <Input
                      value={document[field]}
                      readOnly={locked}
                      aria-invalid={editor.invalid === field || undefined}
                      onPaste={(event) => paste_single_line(event, field)}
                      onChange={(event) =>
                        editor.edit({
                          ...editor.draft,
                          document: { ...document, [field]: event.target.value },
                        })
                      }
                    />
                    {editor.invalid === field && !readonly && (
                      <span className="skill-editor__field-error">
                        {t(`skills_page.editor.invalid_${field}`)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {editor.file.text === null ? (
              <div className="skill-editor__unsupported">
                {t("skills_page.editor.unsupported")}
                <span>{editor.file.size.toLocaleString()} B</span>
              </div>
            ) : (
              <AppEditor
                key={editor.file.path}
                class_name="skill-editor__text"
                aria_label={editor.file.path}
                syntax={
                  /\.(md|markdown)$/i.test(editor.file.path)
                    ? "markdown"
                    : /\.json$/i.test(editor.file.path)
                      ? "json"
                      : /\.(m?js|ts|tsx|jsx)$/i.test(editor.file.path)
                        ? "typescript"
                        : "plain"
                }
                read_only={locked}
                indent_with_tab
                value={document?.body ?? editor.draft.text}
                on_change={(text) =>
                  editor.edit(
                    document
                      ? { ...editor.draft, document: { ...document, body: text } }
                      : { text },
                  )
                }
              />
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
