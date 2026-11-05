import { type JSX, type ReactNode, Fragment, useState } from "react";
import { ChevronLeft, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { CommandBar } from "@frontend/widgets/command-bar/command-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import "./document-editor.css";
/** 文件与角色编辑共用导航、保存反馈和危险操作，具体写入由各自编辑状态拥有。 */
export function DocumentEditorToolbar(props: {
  path: string[];
  confirm_description?: string; // 仅在提供 action 时使用
  status: "saved" | "modified" | "save_failed" | "conflict" | null; // 在途保存也显示已修改。
  recovery?: ReactNode;
  busy: boolean;
  locked: boolean;
  action?: "delete" | "reset" | undefined;
  on_back: () => void;
  on_action?: () => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [confirming, set_confirming] = useState(false);
  const action_label = props.action ? t(`knowledge_page.editor.${props.action}`) : "";
  return (
    <>
      <CommandBar
        className="document-editor__toolbar"
        actions={
          <div className="document-editor__toolbar-start">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.busy}
                  aria-label={t("knowledge_page.editor.back")}
                  onClick={props.on_back}
                >
                  <ChevronLeft />
                </AppButton>
              </TooltipTrigger>
              <TooltipContent>{t("knowledge_page.editor.back")}</TooltipContent>
            </Tooltip>
            <div className="document-editor__file-info">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="document-editor__path">
                      {props.path.map((part, index) => (
                        <Fragment key={index}>
                          {index > 0 && <span className="document-editor__path-separator">/</span>}
                          <span
                            className="document-editor__path-segment"
                            data-directory={
                              (index > 0 && index < props.path.length - 1) || undefined
                            }
                          >
                            {part}
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  }
                />
                <TooltipContent>{props.path.join(" / ")}</TooltipContent>
              </Tooltip>
              {props.status && (
                <span className="document-editor__status" data-status={props.status}>
                  <span aria-hidden="true">·</span>
                  <span className="document-editor__status-label">
                    {t(`knowledge_page.editor.${props.status}`)}
                  </span>
                </span>
              )}
            </div>
          </div>
        }
        hint={
          <span className="document-editor__toolbar-end">
            {props.recovery}
            {props.action ? (
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
            ) : null}
          </span>
        }
      />
      {props.action && props.on_action && (
        <AppConfirmDialog
          open={confirming}
          confirmDisabled={props.locked}
          submitting={props.busy}
          description={props.confirm_description}
          onClose={() => set_confirming(false)}
          onConfirm={async () => {
            if (!props.locked && (await props.on_action?.())) set_confirming(false);
          }}
        />
      )}
    </>
  );
}
