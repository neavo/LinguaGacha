import { useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import type { AgentMessageAttachment } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationViewer,
} from "./agent-response-annotation";
import { AgentMediaPreviewDialog } from "./agent-media-preview-dialog";

type AgentMessageAttachmentsProps =
  | {
      mode: "draft";
      attachments: readonly AgentMessageAttachment[];
      disabled: boolean; // 只锁草稿修改，图片只读预览仍可打开。
      on_update_annotation: (index: number, comment: string) => void;
      on_remove: (index: number) => void;
    }
  | {
      mode: "sent";
      attachments: readonly AgentMessageAttachment[];
    };

/** 两处附件条共享可见顺序，同时保留原索引供草稿编辑和详情选择使用。 */
function order_agent_attachment_items(
  attachments: readonly AgentMessageAttachment[],
): { attachment: AgentMessageAttachment; index: number }[] {
  return attachments
    .map((attachment, index) => ({ attachment, index }))
    .sort((left, right) => {
      if (left.attachment.kind === right.attachment.kind) return 0;
      return left.attachment.kind === "image" ? -1 : 1;
    });
}

/** 草稿与已发送消息共用附件顺序、缩略图和展开容器，模式只决定是否提供修改动作。 */
export function AgentMessageAttachments(props: AgentMessageAttachmentsProps): JSX.Element {
  const { t } = useI18n();
  // 展开态始终保存协议原索引；视觉排序不能改变草稿修改和详情读取的目标。
  const [selected_index, set_selected_index] = useState<number | null>(null);
  const [annotation_comment, set_annotation_comment] = useState("");
  const ordered_attachment_items = order_agent_attachment_items(props.attachments);
  const has_images = props.attachments.some((attachment) => attachment.kind === "image");
  const selected_attachment =
    selected_index === null ? undefined : props.attachments[selected_index];

  /** 打开时同时冻结当前评论草稿，避免编辑过程追随父级附件引用变化。 */
  const open_attachment = (index: number, attachment: AgentMessageAttachment): void => {
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
      <div className="agent-attachment-strip" data-has-images={has_images || undefined}>
        {ordered_attachment_items.map(({ attachment, index }, display_index) => {
          const title = t(
            attachment.kind === "image" ? "agent_page.image.title" : "agent_page.annotation.title",
          );
          const trigger = (
            <button
              key={index}
              type="button"
              className={`agent-attachment agent-attachment--${
                attachment.kind === "image" ? "image" : "annotation"
              }`}
              aria-label={`${title} ${display_index + 1}`}
              disabled={
                attachment.kind === "response_annotation" &&
                props.mode === "draft" &&
                props.disabled
              }
              onClick={
                attachment.kind === "image" ? () => open_attachment(index, attachment) : undefined
              }
            >
              {attachment.kind === "image" ? (
                <img
                  src={`data:image/webp;base64,${attachment.webpBase64}`}
                  alt=""
                  decoding="async"
                />
              ) : (
                <>
                  <MessageSquareQuote aria-hidden="true" />
                  <span>{attachment.selectedText}</span>
                </>
              )}
            </button>
          );

          if (attachment.kind === "image") return trigger;

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

      {selected_attachment?.kind !== "image" ? null : (
        <AgentMediaPreviewDialog
          key={selected_index}
          open
          title={t("agent_page.image.title")}
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
          <img
            src={`data:image/webp;base64,${selected_attachment.webpBase64}`}
            alt=""
            decoding="async"
          />
        </AgentMediaPreviewDialog>
      )}
    </>
  );
}
