import type { AgentDraftAttachment } from "@frontend/app/session/agent/agent-input-draft";
import { api_blob } from "@frontend/app/desktop/desktop-api";
import { type JSX, useEffect, useState } from "react";
import { File, LoaderCircle, MessageSquareQuote, CircleAlert, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type {
  AgentFileAttachment,
  AgentMessageAttachment,
  AgentResponseAnnotationAttachment,
} from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationViewer,
} from "./agent-response-annotation";
import { AgentFileTrigger } from "./agent-file-trigger";

type AgentMessageAttachmentsProps =
  | {
      mode: "draft";
      attachments: readonly AgentDraftAttachment[];
      disabled: boolean; // 锁定草稿修改，已上传文件仍可查看与保存。
      on_update_annotation: (index: number, comment: string) => void;
      on_remove: (index: number) => void;
      on_retry: (id: string) => void;
    }
  | { mode: "sent"; attachments: readonly AgentMessageAttachment[] };

/** 草稿与消息共用紧凑附件外壳，修改动作只交还草稿拥有者。 */
export function AgentMessageAttachments(props: AgentMessageAttachmentsProps): JSX.Element {
  const { t } = useI18n();
  // 按附件对象追踪展开目标，前项移除或上传完成后仍能找到当前索引。
  const [selected, set_selected] = useState<AgentResponseAnnotationAttachment | null>(null);
  const [annotation_comment, set_annotation_comment] = useState("");
  const selected_index = props.attachments.findIndex((attachment) => attachment === selected);
  const selected_attachment = props.attachments[selected_index];
  const locked = props.mode === "draft" && props.disabled;

  /** 关闭批注浮层。 */
  const close_annotation = (): void => set_selected(null);
  /** 打开时复制批注文字，编辑中的内容由局部草稿持有。 */
  const open_annotation = (attachment: AgentResponseAnnotationAttachment): void => {
    set_selected(attachment);
    set_annotation_comment(attachment.comment);
  };
  /** 保存前核对当前附件与权限，再按最新索引交还草稿拥有者。 */
  const save_annotation = (): void => {
    if (props.mode !== "draft" || locked || selected_attachment?.kind !== "response_annotation")
      return;
    close_annotation();
    props.on_update_annotation(selected_index, annotation_comment.trim());
  };

  return (
    <div className="agent-attachment-strip">
      {props.attachments.map((attachment, index) => {
        const annotation = attachment.kind === "response_annotation";
        const image = attachment.kind === "file" && attachment.imageMimeType !== null;
        const pending = attachment.kind === "upload";
        const name = annotation ? attachment.selectedText : attachment.name;
        const open = selected_attachment === attachment;
        const status = pending
          ? t(
              attachment.status === "failed"
                ? "agent_page.upload.failed"
                : "agent_page.upload.uploading",
            )
          : "";
        const hint = pending
          ? name +
            "\n" +
            status +
            (attachment.status === "failed" ? " · " + t("app.action.retry") : "")
          : name;
        const content = (
          <>
            <span
              className="agent-attachment__preview"
              data-failed={pending && attachment.status === "failed" ? "" : undefined}
            >
              {annotation ? (
                <MessageSquareQuote aria-hidden="true" />
              ) : image ? (
                <AgentUploadImage file={attachment} />
              ) : pending && attachment.status === "uploading" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : pending ? (
                <CircleAlert aria-hidden="true" />
              ) : (
                <File aria-hidden="true" />
              )}
            </span>
            <span className="agent-attachment__name">{name}</span>
          </>
        );
        const trigger =
          attachment.kind === "file" ? (
            <AgentFileTrigger
              path={attachment.path.split("/").map(encodeURIComponent).join("/")}
              render={<button type="button" className="agent-attachment__body" />}
            >
              {content}
            </AgentFileTrigger>
          ) : (
            <button
              type="button"
              className="agent-attachment__body"
              aria-label={annotation ? t("agent_page.annotation.title") + " " + (index + 1) : hint}
              aria-disabled={
                pending && (locked || attachment.status === "uploading") ? true : undefined
              }
              disabled={annotation && locked}
              onClick={() => {
                if (pending) {
                  if (props.mode === "draft" && !locked && attachment.status === "failed")
                    props.on_retry(attachment.id);
                }
              }}
            >
              {content}
            </button>
          );
        const key = pending
          ? attachment.id
          : attachment.kind === "file"
            ? attachment.uploadId
            : index;
        const block = (
          <div className="agent-attachment" key={key}>
            <Tooltip disabled={open}>
              <TooltipTrigger
                render={
                  annotation ? (
                    <PopoverPrimitive.Trigger render={trigger} />
                  ) : attachment.kind === "file" ? (
                    <span>{trigger}</span>
                  ) : (
                    trigger
                  )
                }
              />
              <TooltipContent>
                <span className="agent-attachment__tooltip-text">{hint}</span>
              </TooltipContent>
            </Tooltip>
            {props.mode === "draft" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="agent-attachment__remove"
                      aria-label={t("app.action.delete")}
                      disabled={locked}
                      onClick={() => {
                        if (open) close_annotation();
                        props.on_remove(index);
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  }
                />
                <TooltipContent>{t("app.action.delete")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        );
        // 文件动作由统一入口处理，只有批注拥有局部展开态。
        if (!annotation) return block;
        return (
          <PopoverPrimitive.Root
            key={key}
            open={open}
            onOpenChange={(next_open) => {
              if (next_open) open_annotation(attachment);
              else if (open) close_annotation();
            }}
          >
            {block}
            {open ? (
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Positioner
                  className="isolate z-(--ui-layer-popover) [-webkit-app-region:no-drag]"
                  side="top"
                  align="start"
                  sideOffset={6}
                  collisionPadding={8}
                >
                  <PopoverPrimitive.Popup initialFocus={false}>
                    {props.mode === "draft" ? (
                      <AgentResponseAnnotationEditor
                        className="agent-composer__annotation-editor"
                        aria-label={t("agent_page.annotation.edit")}
                        selected_text={attachment.selectedText}
                        comment={annotation_comment}
                        on_comment_change={set_annotation_comment}
                        on_submit={save_annotation}
                        on_cancel={close_annotation}
                      />
                    ) : (
                      <AgentResponseAnnotationViewer
                        className="agent-message__annotation-viewer"
                        aria-label={t("agent_page.annotation.title")}
                        selected_text={attachment.selectedText}
                        comment={attachment.comment}
                        on_cancel={close_annotation}
                      />
                    )}
                  </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
              </PopoverPrimitive.Portal>
            ) : null}
          </PopoverPrimitive.Root>
        );
      })}
    </div>
  );
}
/** 后端字节通过 API 读取，页面只渲染 CSP 已允许的 Blob URL。 */
function AgentUploadImage({ file }: { file: AgentFileAttachment }): JSX.Element {
  const [source, set_source] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    void api_blob(`/api/agent/uploads/${file.uploadId}`, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        set_source({ id: file.uploadId, url });
      })
      .catch(() => {
        // 重置或文件失效时保留附件名称，用户仍可移除引用。
        if (!controller.signal.aborted) set_source(null);
      });
    return () => {
      controller.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [file.uploadId]);
  return (
    <img src={source?.id === file.uploadId ? source.url : undefined} alt="" decoding="async" />
  );
}
