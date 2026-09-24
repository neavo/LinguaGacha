import {
  Fragment,
  useEffect,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ChevronLeft, RotateCcw, Trash2 } from "lucide-react";
import { AGENT_SKILL_MAIN_FILE, type AgentSkillIdentity } from "@shared/agent-skills";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { AppButton } from "@frontend/widgets/app-button";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { CommandBar } from "@frontend/widgets/command-bar/command-bar";
import { Card } from "@frontend/shadcn/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { SkillFileTree } from "./skill-file-tree";
import { useSkillEditor } from "./use-skill-editor";
import { skill_editor_extension } from "./skill-editor-extension";
import "./skill-editor.css";

/** 组合技能导航与连续编辑文档，并将自动保存接入离页流程。 */
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
  useEffect(() => register_before_leave(editor.flush), [editor.flush, register_before_leave]);
  const readonly = skill.source === "builtin" || editor.locked;
  const locked = readonly || editor.busy || leaving;
  const path_parts = [
    editor.file?.skill.name ?? skill.name,
    ...(editor.file?.path ?? AGENT_SKILL_MAIN_FILE).split("/"),
  ];
  return (
    <section
      className="skill-editor"
      onCompositionStart={() => editor.compose(true)}
      onCompositionEnd={() => editor.compose(false)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (!locked) void editor.flush();
        }
      }}
    >
      <SkillEditorToolbar
        path={path_parts}
        status={
          skill.source === "user" && editor.file?.text != null
            ? editor.dirty || editor.saving
              ? "modified"
              : "saved"
            : null
        }
        busy={editor.busy || leaving}
        locked={locked || editor.loading || !editor.file}
        action={skill.source === "user" ? "delete" : undefined}
        on_back={() => {
          void editor.flush().then((ok) => {
            if (ok) on_back();
          });
        }}
        on_action={async () => {
          const ok = await editor.delete_skill();
          if (ok) on_back();
          return ok;
        }}
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
        <SkillEditorWorkspace
          entries={editor.tree.entries}
          path={editor.file.path}
          readonly={readonly}
          busy={editor.busy || leaving}
          on_open={editor.open_file}
          on_change={editor.change_file}
        >
          <Card className="skill-editor__content" data-readonly={readonly || undefined}>
            {editor.error && (
              <div className="skill-editor__error" role="alert">
                <span>{editor.conflict ? t("skills_page.editor.conflict") : editor.error}</span>
                <div>
                  <AppButton
                    size="sm"
                    variant="outline"
                    disabled={locked || editor.saving}
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
                      disabled={locked || editor.saving}
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
                <span>{t(`skills_page.editor.invalid_${editor.invalid}`)}</span>
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
            {editor.file.text === null ? (
              <div className="skill-editor__unsupported">
                {t("skills_page.editor.unsupported")}
                <span>{editor.file.size.toLocaleString()} B</span>
              </div>
            ) : (
              <AppEditor
                key={`${editor.file.path}:${editor.reset_count}`}
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
                aria_invalid={editor.invalid !== null}
                extensions={editor.file.document ? skill_editor_extension : undefined}
                indent_with_tab
                value={editor.draft}
                on_change={editor.edit}
              />
            )}
          </Card>
        </SkillEditorWorkspace>
      )}
    </section>
  );
}

/** 文件与角色编辑共用导航、保存反馈和危险操作，具体写入由各自编辑状态拥有。 */
export function SkillEditorToolbar(props: {
  path: string[];
  status: "saved" | "modified" | null; // 草稿有差异或保存尚在进行时均为已修改，防止在途撤销提前显示已保存。
  busy: boolean;
  locked: boolean;
  action?: "delete" | "reset";
  on_back: () => void;
  on_action: () => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [confirming, set_confirming] = useState(false);
  const action_label = props.action ? t(`skills_page.editor.${props.action}`) : "";
  return (
    <>
      <CommandBar
        className="skill-editor__toolbar"
        actions={
          <div className="skill-editor__toolbar-start">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.busy}
                  aria-label={t("skills_page.editor.back")}
                  onClick={props.on_back}
                >
                  <ChevronLeft />
                </AppButton>
              </TooltipTrigger>
              <TooltipContent>{t("skills_page.editor.back")}</TooltipContent>
            </Tooltip>
            <div className="skill-editor__file-info">
              <span className="skill-editor__path" title={props.path.join(" / ")}>
                {props.path.map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && <span className="skill-editor__path-separator">/</span>}
                    <span
                      className="skill-editor__path-segment"
                      data-directory={(index > 0 && index < props.path.length - 1) || undefined}
                    >
                      {part}
                    </span>
                  </Fragment>
                ))}
              </span>
              {props.status && (
                <span className="skill-editor__status" data-status={props.status}>
                  <span aria-hidden="true">·</span>
                  <span className="skill-editor__status-label">
                    {t(`skills_page.editor.${props.status}`)}
                  </span>
                </span>
              )}
            </div>
          </div>
        }
        hint={
          props.action ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <AppButton
                    variant="ghost"
                    size="icon"
                    className={props.action === "delete" ? "hover:text-destructive" : undefined}
                    disabled={props.busy || props.locked}
                    aria-label={action_label}
                    onClick={() => set_confirming(true)}
                  />
                }
              >
                {props.action === "reset" ? <RotateCcw /> : <Trash2 />}
              </TooltipTrigger>
              <TooltipContent side="left">{action_label}</TooltipContent>
            </Tooltip>
          ) : undefined
        }
      />
      {props.action && (
        <AppConfirmDialog
          open={confirming}
          confirmDelay
          confirmDisabled={props.locked}
          submitting={props.busy}
          description={t(`skills_page.editor.${props.action}_skill_confirm`)}
          onClose={() => set_confirming(false)}
          onConfirm={async () => {
            if (!props.locked && (await props.on_action())) set_confirming(false);
          }}
        />
      )}
    </>
  );
}

const TREE_WIDTH = { initial: 220, min: 180, max: 480, step: 20 };

/** 普通技能与人格技能共用文件树、分栏尺寸和键盘调整行为。 */
export function SkillEditorWorkspace({
  children,
  ...tree
}: ComponentProps<typeof SkillFileTree> & { children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const [width, set_width] = useState(TREE_WIDTH.initial);
  return (
    <div
      className="skill-editor__workspace"
      style={{ "--skill-tree-width": `${width}px` } as CSSProperties}
    >
      <Card render={<aside />} className="skill-editor__tree">
        <SkillFileTree {...tree} />
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
      {children}
    </div>
  );
}
