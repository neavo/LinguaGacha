import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { AgentImage } from "../../../shared/agent-image";
const AGENT_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-ms-bmp",
]);
const AGENT_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "jpeg", "jpg", "png", "webp"]);

export const AGENT_IMAGE_FILE_ACCEPT =
  ".png,.jpg,.jpeg,.bmp,.webp,.avif,image/png,image/jpeg,image/bmp,image/webp,image/avif";

/** 文件选择、拖入与粘贴共用同一格式边界；实际解码仍交给 Chromium。 */
export function is_agent_image_file(file: File): boolean {
  if (AGENT_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) return true;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return AGENT_IMAGE_EXTENSIONS.has(extension);
}

/** 输入入口只上传原图，格式与压缩策略由后端统一决定，批次保持输入顺序。 */
export async function normalize_agent_images(files: Iterable<File>): Promise<string[]> {
  const images = Array.from(files);
  if (!images.every(is_agent_image_file)) throw new TypeError("unsupported_agent_image");
  return await Promise.all(
    images.map(async (file) => {
      const image = await api_fetch<AgentImage>("/api/agent/image/prepare", {
        data: await read_blob_base64(file),
      });
      return image.data;
    }),
  );
}

/** 去掉 FileReader 生成的 data URL 头，只上传原始文件的 base64 正文，后端决定图片处理。 */
function read_blob_base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("agent_image_read_failed"));
    reader.onload = () => {
      const data_url = typeof reader.result === "string" ? reader.result : "";
      const base64 = data_url.slice(data_url.indexOf(",") + 1);
      if (base64 === "") reject(new Error("agent_image_read_failed"));
      else resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}
