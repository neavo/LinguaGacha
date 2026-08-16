import { useState } from "react";
import { MessageSquareQuote } from "lucide-react";

import type { AgentMessageAttachment } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type AgentMessageAttachmentsProps = {
  attachments: readonly AgentMessageAttachment[];
};

/** 两处附件条共享可见顺序，同时保留原索引供草稿编辑和详情选择使用。 */
export function order_agent_attachment_items(
  attachments: readonly AgentMessageAttachment[],
): { attachment: AgentMessageAttachment; index: number }[] {
  return attachments
    .map((attachment, index) => ({ attachment, index }))
    .sort((left, right) => {
      if (left.attachment.kind === right.attachment.kind) return 0;
      return left.attachment.kind === "image" ? -1 : 1;
    });
}

/** 消息附件只负责只读预览与详情选择，原始顺序和内容始终由消息条目拥有。 */
export function AgentMessageAttachments(props: AgentMessageAttachmentsProps): JSX.Element {
  const { t } = useI18n();
  const [selected_index, set_selected_index] = useState<number | null>(null);
  const ordered_attachment_items = order_agent_attachment_items(props.attachments);
  const has_images = props.attachments.some((attachment) => attachment.kind === "image");
  const selected_attachment =
    selected_index === null ? undefined : props.attachments[selected_index];

  return (
    <>
      <div className="agent-attachment-strip" data-has-images={has_images || undefined}>
        {ordered_attachment_items.map(({ attachment, index }, display_index) => {
          const title = t(
            attachment.kind === "image" ? "agent_page.image.title" : "agent_page.annotation.title",
          );
          return (
            <button
              type="button"
              className={`agent-attachment agent-attachment--${attachment.kind === "image" ? "image" : "annotation"} agent-attachment__open`}
              aria-label={`${title} ${display_index + 1}`}
              key={index}
              onClick={() => set_selected_index(index)}
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
        })}
      </div>

      {selected_attachment === undefined ? null : (
        <AppPageDialog
          open
          size="md"
          title={t(
            selected_attachment.kind === "image"
              ? "agent_page.image.title"
              : "agent_page.annotation.title",
          )}
          onClose={() => set_selected_index(null)}
        >
          {selected_attachment.kind === "image" ? (
            <div className="agent-message-attachment-detail agent-message-attachment-detail--image">
              <img
                src={`data:image/webp;base64,${selected_attachment.webpBase64}`}
                alt=""
                decoding="async"
              />
            </div>
          ) : (
            <div className="agent-message-attachment-detail">
              <section>
                <strong>{t("agent_page.annotation.selected_text")}</strong>
                <blockquote className="agent-message-attachment-detail__target">
                  {selected_attachment.selectedText}
                </blockquote>
              </section>
              {selected_attachment.comment === "" ? null : (
                <section>
                  <strong>{t("agent_page.annotation.user_comment")}</strong>
                  <p className="agent-message-attachment-detail__comment">
                    {selected_attachment.comment}
                  </p>
                </section>
              )}
            </div>
          )}
        </AppPageDialog>
      )}
    </>
  );
}
