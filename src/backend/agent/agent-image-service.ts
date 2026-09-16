import { createHash } from "node:crypto";
import type { AgentImage, AgentImageHost, AgentImageHostResult } from "../../shared/agent-image";
import { AppError } from "../../shared/error";

export const AGENT_IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const AGENT_IMAGE_POLICY = Object.freeze({
  maxEdge: 1920,
  maxPixels: 32_000_000,
  maxBytes: 3 * 1024 * 1024,
  quality: 0.85,
});
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;

/** 附件与工作区共用的规范图片入口；缓存淘汰不影响草稿和历史持有的结果。 */
export class AgentImageService {
  private readonly cache = new Map<string, AgentImage>(); // 插入顺序就是最近使用顺序
  private cache_bytes = 0; // 按摘要条目累计 base64 的 UTF-16 内存上界
  private lifetime = new AbortController(); // reset 取消旧转换，迟到结果不能重新填充缓存

  /** 宿主执行编解码，服务独占图片策略与会话缓存。 */
  public constructor(private readonly host: AgentImageHost) {}

  /** JSON 传输边界只接受有界、完整的 base64，不信任客户端声明的格式。 */
  public async prepare_base64(data: unknown): Promise<AgentImage> {
    if (
      typeof data !== "string" ||
      data.length === 0 ||
      data.length > Math.ceil(AGENT_IMAGE_INPUT_MAX_BYTES / 3) * 4
    )
      throw image_error("invalid_image_input");
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) throw image_error("invalid_image_base64");
    return await this.prepare(bytes);
  }

  /** 读取时固定输入内容，缓存按字节身份复用，文件路径不参与图片身份。 */
  public async prepare(input: Uint8Array, signal?: AbortSignal): Promise<AgentImage> {
    const effective_signal =
      signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]);
    effective_signal.throwIfAborted();
    if (input.byteLength === 0 || input.byteLength > AGENT_IMAGE_INPUT_MAX_BYTES)
      throw image_error("image_input_too_large");
    const bytes = Uint8Array.from(input);
    const key = digest(bytes);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const mimeType = read_image_type(bytes);
    if (mimeType === null) throw image_error("unsupported_image");
    let result: AgentImageHostResult;
    try {
      result = await this.host(
        { kind: "prepare_image", bytes, mimeType, policy: AGENT_IMAGE_POLICY },
        effective_signal,
      );
    } catch (cause) {
      effective_signal.throwIfAborted();
      throw image_error("image_processing_failed", cause);
    }
    effective_signal.throwIfAborted();
    if (
      read_image_type(result.bytes) !== "image/webp" ||
      result.bytes.byteLength > AGENT_IMAGE_POLICY.maxBytes ||
      !Number.isInteger(result.width) ||
      !Number.isInteger(result.height) ||
      result.width < 1 ||
      result.height < 1 ||
      Math.max(result.width, result.height) > AGENT_IMAGE_POLICY.maxEdge
    )
      throw image_error("invalid_image_result");
    const image: AgentImage = Object.freeze({
      data: Buffer.from(result.bytes).toString("base64"),
      mimeType: "image/webp",
      width: result.width,
      height: result.height,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
    });
    this.remember(key, image);
    // 上传准备后的规范字节会随消息再次提交，同样命中此结果。
    this.remember(
      digest(result.bytes),
      image.originalWidth === image.width && image.originalHeight === image.height
        ? image
        : Object.freeze({ ...image, originalWidth: image.width, originalHeight: image.height }),
    );
    return image;
  }

  /** 先取消旧转换，再清空缓存并为新会话建立取消边界。 */
  public clear(): void {
    this.lifetime.abort(new AppError("runtime.cancelled"));
    this.lifetime = new AbortController();
    this.cache.clear();
    this.cache_bytes = 0;
  }

  /** 刷新摘要的使用顺序，超预算时淘汰最早使用的条目。 */
  private remember(key: string, image: AgentImage): void {
    const previous = this.cache.get(key);
    if (previous !== undefined) this.cache_bytes -= previous.data.length * 2;
    this.cache.delete(key);
    this.cache.set(key, image);
    // 用 UTF-16 上界计费；多个摘要引用同一结果时也独立计费，保持预算简单且保守。
    this.cache_bytes += image.data.length * 2;
    while (this.cache_bytes > IMAGE_CACHE_BYTES) {
      const [oldest_key, oldest_image] = this.cache.entries().next().value!;
      this.cache.delete(oldest_key);
      this.cache_bytes -= oldest_image.data.length * 2;
    }
  }
}

/** 同一内容在上传、工作区和规范结果入口使用同一缓存身份。 */
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 文件头只负责选择允许的解码格式，完整有效性由 Chromium 解码证明。 */
function read_image_type(bytes: Uint8Array): string | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  if (data.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (data.toString("ascii", 4, 8) === "ftyp") {
    const box_size = Math.min(data.readUInt32BE(0), data.length);
    for (let offset = 8; offset + 4 <= box_size; offset += 4) {
      if (offset !== 12 && ["avif", "avis"].includes(data.toString("ascii", offset, offset + 4)))
        return "image/avif";
    }
  }
  return null;
}

/** 公开原因只携带分类，原始编解码错误留在诊断原因链。 */
function image_error(reason: string, cause?: unknown): AppError {
  return new AppError("request.validation_failed", { cause, public_details: { reason } });
}
