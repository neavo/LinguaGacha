import { createHash } from "node:crypto";
import {
  AGENT_IMAGE_DEFAULT_MAX_EDGE,
  type AgentImage,
  type AgentImagePolicy,
  type AgentImageHost,
  type AgentImageHostResult,
  type AgentImageOptions,
} from "../../shared/agent-image";
import { AppError } from "../../shared/error";

export const AGENT_IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const AGENT_IMAGE_POLICY = Object.freeze({
  maxEdge: AGENT_IMAGE_DEFAULT_MAX_EDGE,
  maxPixels: 32_000_000,
  maxBytes: 3 * 1024 * 1024,
  quality: 0.85,
});
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;

/** 附件发送与工作区共用的规范图片入口；模型历史持有独立于缓存生命周期的结果。 */
export class AgentImageService {
  private readonly cache = new Map<string, AgentImage>(); // 插入顺序就是最近使用顺序
  private cache_bytes = 0; // 按摘要条目累计 base64 的 UTF-16 内存上界
  private lifetime = new AbortController(); // reset 取消旧转换，迟到结果不能重新填充缓存
  private readonly pending = new Map<string, Promise<AgentImage>>(); // 同内容和尺寸的消费者共用在途转换

  /** 宿主执行编解码，服务独占图片策略与会话缓存。 */
  public constructor(private readonly host: AgentImageHost) {}

  /** 工作区选项由父进程校验。这里捕获单次策略，使宿主处理和缓存使用同一尺寸。 */
  public async prepare(
    input: Uint8Array,
    signal?: AbortSignal,
    options: AgentImageOptions = {},
  ): Promise<AgentImage> {
    const maxEdge = options.maxEdge ?? AGENT_IMAGE_DEFAULT_MAX_EDGE;
    const policy = Object.freeze({ ...AGENT_IMAGE_POLICY, maxEdge });
    const effective_signal =
      signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]);
    effective_signal.throwIfAborted();
    if (input.byteLength === 0 || input.byteLength > AGENT_IMAGE_INPUT_MAX_BYTES)
      throw image_error("image_input_too_large");
    const bytes = Uint8Array.from(input);
    const key = `${maxEdge}:${digest(bytes)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    let operation = this.pending.get(key);
    if (operation === undefined) {
      // 转换归会话拥有，单个调用者取消只结束自身等待，不中断其它消费者。
      operation = this.convert(bytes, key, policy, this.lifetime.signal);
      this.pending.set(key, operation);
      // 此分支只清理登记，转换失败由返回给调用者的原 `Promise` 传递。
      void operation
        .finally(() => {
          if (this.pending.get(key) === operation) this.pending.delete(key);
        })
        .catch(() => undefined);
    }
    if (signal === undefined) return operation;
    return await new Promise<AgentImage>((resolve, reject) => {
      const cancel = (): void => reject(effective_signal.reason);
      effective_signal.addEventListener("abort", cancel, { once: true });
      void operation
        .then(resolve, reject)
        .finally(() => effective_signal.removeEventListener("abort", cancel));
    });
  }

  /** 宿主结果通过校验且仍属于当前会话时，才写入成功缓存。 */
  private async convert(
    bytes: Uint8Array,
    key: string,
    policy: AgentImagePolicy,
    effective_signal: AbortSignal,
  ): Promise<AgentImage> {
    const mimeType = read_image_type(bytes);
    if (mimeType === null) throw image_error("unsupported_image");
    let result: AgentImageHostResult;
    try {
      result = await this.host(
        { kind: "prepare_image", bytes, mimeType, policy },
        effective_signal,
      );
    } catch (cause) {
      effective_signal.throwIfAborted();
      throw image_error("image_processing_failed", cause);
    }
    effective_signal.throwIfAborted();
    if (
      read_image_type(result.bytes) !== "image/webp" ||
      result.bytes.byteLength > policy.maxBytes ||
      !Number.isInteger(result.width) ||
      !Number.isInteger(result.height) ||
      result.width < 1 ||
      result.height < 1 ||
      Math.max(result.width, result.height) > policy.maxEdge
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
    return image;
  }

  /** 先取消旧转换，再清空缓存并为新会话建立取消边界。 */
  public clear(): void {
    this.lifetime.abort(new AppError("runtime.cancelled"));
    this.lifetime = new AbortController();
    this.cache.clear();
    this.pending.clear();
    this.cache_bytes = 0;
  }

  /** 登记新输入的结果，超预算时淘汰最早使用的条目。 */
  private remember(key: string, image: AgentImage): void {
    this.cache.set(key, image);
    // 按 base64 字符串的 UTF-16 内存上界计费。
    this.cache_bytes += image.data.length * 2;
    while (this.cache_bytes > IMAGE_CACHE_BYTES) {
      const [oldest_key, oldest_image] = this.cache.entries().next().value!;
      this.cache.delete(oldest_key);
      this.cache_bytes -= oldest_image.data.length * 2;
    }
  }
}

/** 附件发送与工作区输出按原始字节共用缓存身份。 */
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 文件头只负责选择允许的解码格式，完整有效性由 Chromium 解码证明。 */
export function read_image_type(bytes: Uint8Array): string | null {
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
