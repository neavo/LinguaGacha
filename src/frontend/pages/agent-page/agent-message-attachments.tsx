import type { AgentDraftAttachment } from "@frontend/app/session/agent/agent-input-draft";
import { api_blob, api_file_url } from "@frontend/app/desktop/desktop-api";
import { useEffect, useState } from "react";
import { File, LoaderCircle, MessageSquareQuote } from "lucide-react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import type { AgentFileAttachment, AgentMessageAttachment } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationViewer,
} from "./agent-response-annotation";
import { AgentMediaPreviewDialog } from "./agent-media-preview-dialog";

type AgentMessageAttachmentsProps =
  | {
      mode: "draft";
      attachments: readonly AgentDraftAttachment[];
      disabled: boolean; // 只锁草稿修改，图片只读预览仍可打开。
      on_update_annotation: (index: number, comment: string) => void;
      on_remove: (index: number) => void;
      on_retry: (id: string) => void;
    }
  | {
      mode: "sent";
      attachments: readonly AgentMessageAttachment[];
    };

/** 草稿与已发送消息共用附件顺序、缩略图和展开容器，模式只决定是否提供修改动作。 */
export function AgentMessageAttachments(props: AgentMessageAttachmentsProps): JSX.Element {
  const { t } = useI18n();
  // 附件按输入顺序展示，展开态和草稿修改共用原索引。
  const [selected_index, set_selected_index] = useState<number | null>(null);
  const [annotation_comment, set_annotation_comment] = useState("");
  const selected_attachment =
    selected_index === null ? undefined : props.attachments[selected_index];

  /** 打开时同时冻结当前评论草稿，避免编辑过程追随父级附件引用变化。 */
  const open_attachment = (index: number, attachment: AgentDraftAttachment): void => {
    set_selected_index(index);
    set_annotation_comment(attachment.kind === "response_annotation" ? attachment.comment : "");
  };

  const close_attachment = (): void => set_selected_index(null);

  /** 修改动作始终携带原附件索引，并先关闭局部 UI 再交还权威草稿拥有者。 */
  const remove_selected_attachment = (): void => {
    if (props.mode !== "draft" || selected_index === null) return;
    const index = selected_index;
    close_attachment();
    props.on_remove(index);
  };

  /** 保存前重新校验原索引仍指向批注，防止权威草稿替换后误写其它附件。 */
  const save_selected_annotation = (): void => {
    if (
      props.mode !== "draft" ||
      selected_index === null ||
      selected_attachment?.kind !== "response_annotation"
    ) {
      return;
    }
    const index = selected_index;
    close_attachment();
    props.on_update_annotation(index, annotation_comment.trim());
  };

  return (
    <>
      <div className="agent-attachment-strip">
        {props.attachments.map((attachment, index) => {
          if (
            attachment.kind === "upload" ||
            (attachment.kind === "file" && attachment.imageMimeType === null)
          ) {
            const pending = attachment.kind === "upload";
            return (
              <div
                className="agent-attachment agent-attachment--file"
                key={pending ? attachment.id : attachment.uploadId}
              >
                {pending && attachment.status === "uploading" ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <File aria-hidden="true" />
                )}
                <div className="agent-attachment__file-info">
                  {attachment.kind === "file" ? (
                    <a
                      href={api_file_url(`/api/agent/uploads/${attachment.uploadId}`)}
                      download={attachment.name}
                      title={attachment.name}
                    >
                      {attachment.name}
                    </a>
                  ) : (
                    <span title={attachment.name}>{attachment.name}</span>
                  )}
                  <span>
                    {pending
                      ? t(
                          attachment.status === "failed"
                            ? "agent_page.upload.failed"
                            : "agent_page.upload.uploading",
                        )
                      : `${attachment.size.toLocaleString()} B`}
                  </span>
                </div>
                {props.mode === "draft" ? (
                  <div className="agent-attachment__file-actions">
                    {pending && attachment.status === "failed" ? (
                      <AppButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={props.disabled}
                        onClick={() => props.on_retry(attachment.id)}
                      >
                        {t("agent_page.upload.retry")}
                      </AppButton>
                    ) : null}
                    <AppButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={props.disabled}
                      onClick={() => props.on_remove(index)}
                    >
                      {t("app.action.delete")}
                    </AppButton>
                  </div>
                ) : null}
              </div>
            );
          }
          const title = t(
            attachment.kind === "file" ? "agent_page.image.title" : "agent_page.annotation.title",
          );
          const trigger = (
            <button
              key={index}
              type="button"
              className={`agent-attachment agent-attachment--${
                attachment.kind === "file" ? "image" : "annotation"
              }`}
              aria-label={`${title} ${index + 1}`}
              disabled={
                attachment.kind === "response_annotation" &&
                props.mode === "draft" &&
                props.disabled
              }
              onClick={
                attachment.kind === "file" ? () => open_attachment(index, attachment) : undefined
              }
            >
              {attachment.kind === "file" ? (
                <AgentUploadImage file={attachment} />
              ) : (
                <>
                  <MessageSquareQuote aria-hidden="true" />
                  <span>{attachment.selectedText}</span>
                </>
              )}
            </button>
          );

          if (attachment.kind === "file") return trigger;

          const open = selected_index === index;
          return (
            <PopoverPrimitive.Root
              key={index}
              open={open}
              onOpenChange={(next_open) => {
                if (next_open) open_attachment(index, attachment);
                else if (open) close_attachment();
              }}
            >
              <PopoverPrimitive.Trigger render={trigger} />
              {open ? (
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Positioner
                    className="isolate z-(--ui-layer-popover)"
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
                          on_submit={save_selected_annotation}
                          on_cancel={close_attachment}
                          on_remove={remove_selected_attachment}
                        />
                      ) : (
                        <AgentResponseAnnotationViewer
                          className="agent-message__annotation-viewer"
                          aria-label={t("agent_page.annotation.title")}
                          selected_text={attachment.selectedText}
                          comment={attachment.comment}
                          on_cancel={close_attachment}
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

      {selected_attachment?.kind !== "file" ? null : (
        <AgentMediaPreviewDialog
          key={selected_index}
          open
          title={selected_attachment.name}
          onClose={close_attachment}
          footer={
            props.mode === "sent" ? undefined : (
              <>
                <AppButton
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="sm:mr-auto"
                  disabled={props.disabled}
                  onClick={remove_selected_attachment}
                >
                  {t("app.action.delete")}
                </AppButton>
                <AppButton type="button" size="sm" variant="outline" onClick={close_attachment}>
                  {t("app.action.close")}
                </AppButton>
              </>
            )
          }
        >
          <AgentUploadImage file={selected_attachment} />
        </AgentMediaPreviewDialog>
      )}
    </>
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
    <img
      src={source?.id === file.uploadId ? source.url : undefined}
      alt=""
      title={file.name}
      decoding="async"
    />
  );
}
