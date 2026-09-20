import type { ImageContent } from "@earendil-works/pi-ai";
import { AGENT_MESSAGE_IMAGE_LIMIT, type AgentMessageInput } from "../../shared/agent";
import { AppError } from "../../shared/error";
import type { AgentImageService } from "./agent-image-service";
import type { AgentUploadStore } from "./workspace/uploads";

export type PreparedAgentMessage = { text: string; images: ImageContent[] };

/** 所有发送入口共用此处，先固定图片与文件说明，再提交队列和模型历史。 */
export async function prepare_agent_message(
  message: AgentMessageInput,
  uploads: Pick<AgentUploadStore, "get" | "read_image">,
  image_service: Pick<AgentImageService, "prepare">,
): Promise<PreparedAgentMessage> {
  const blocks: string[] = [];
  const files = message.attachments
    .filter((attachment) => attachment.kind === "file")
    .map((attachment) => uploads.get(attachment.uploadId));
  if (files.filter((file) => file.imageMimeType !== null).length > AGENT_MESSAGE_IMAGE_LIMIT)
    throw new AppError("request.validation_failed", {
      public_details: { reason: "too_many_images" },
    });
  const images: ImageContent[] = [];
  const descriptions: { name: string; path: string; bytes: number; image?: number }[] = [];
  for (const file of files) {
    if (file.imageMimeType !== null) {
      const image = await image_service.prepare(uploads.read_image(file.uploadId));
      images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    descriptions.push({
      name: file.name,
      path: file.path,
      bytes: file.size,
      ...(file.imageMimeType === null ? {} : { image: images.length }),
    });
  }
  if (descriptions.length > 0)
    blocks.push(
      [
        "# 本次对话中上传的文件",
        JSON.stringify(descriptions, null, 2),
      ].join("\n\n"),
    );
  const annotations = message.attachments.flatMap((attachment) =>
    attachment.kind === "response_annotation"
      ? [{ text: attachment.selectedText, annotation: attachment.comment }]
      : [],
  );
  if (annotations.length > 0)
    blocks.push(
      [
        "# 本次对话中引用的回复",
        JSON.stringify(annotations, null, 2),
      ].join("\n\n"),
    );
  if (message.text !== "") blocks.push(message.text);
  return { text: blocks.join("\n\n"), images };
}
