// 图片只在 renderer 进入公开协议前归一一次；这些常量共同定义该转换边界。
const AGENT_IMAGE_MAX_EDGE = 1920;
const AGENT_IMAGE_OUTPUT_TYPE = "image/webp";
const AGENT_IMAGE_OUTPUT_QUALITY = 0.85;
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

/** 只缩小超出边界的图片，极窄图片至少保留一个像素。 */
export function resolve_agent_image_size(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, AGENT_IMAGE_MAX_EDGE / width, AGENT_IMAGE_MAX_EDGE / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 批次原子转换并保持输入顺序；任一文件失败时不返回部分结果。 */
export async function normalize_agent_images(files: Iterable<File>): Promise<string[]> {
  const images = Array.from(files);
  if (!images.every(is_agent_image_file)) throw new TypeError("unsupported_agent_image");
  return await Promise.all(images.map(normalize_agent_image));
}

/** 用透明画布完成单图缩放与 WebP 编码，并在成功或失败后释放解码资源。 */
async function normalize_agent_image(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = resolve_agent_image_size(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("agent_image_canvas_unavailable");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result === null) reject(new Error("agent_image_encoding_failed"));
          else resolve(result);
        },
        AGENT_IMAGE_OUTPUT_TYPE,
        AGENT_IMAGE_OUTPUT_QUALITY,
      );
    });
    if (blob.type !== AGENT_IMAGE_OUTPUT_TYPE) throw new Error("agent_image_encoding_failed");
    return await read_blob_base64(blob);
  } finally {
    bitmap.close();
  }
}

/** 去掉 FileReader 生成的 data URL 头，只把公开协议需要的 base64 正文向上传递。 */
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
