import type { AgentFileAttachment } from "../shared/agent";

/** 合成上传记录只用于消息与界面测试，真实存储测试自行上传原始字节。 */
export function uploaded_file(
  id: string,
  imageMimeType: string | null = "image/png",
): AgentFileAttachment {
  return {
    kind: "file",
    uploadId: id,
    name: `${id}.png`,
    path: `uploads/${id}.png`,
    size: 16,
    imageMimeType,
  };
}
