/**
 * 根脚本与 Python helper 之间的二进制帧：4 字节小端 JSON 头长度、UTF-8 JSON 头、`bytes` 声明长度的载荷。
 * 与 `media.py` 的 `Channel` 是同一契约，上限两端一致。
 */
export const CHANNEL_HEADER_MAX = 64 * 1024;
export const CHANNEL_PAYLOAD_MAX = 64 * 1024 * 1024; // 最大输入是 1920 长边画面的检测张量，约 3 MB。

export type ChannelHeader = Readonly<Record<string, unknown>>;
/** 载荷独占自己的 ArrayBuffer，可直接转移给 Worker。 */
export type ChannelFrame = Readonly<{ header: ChannelHeader; payload: Uint8Array<ArrayBuffer> }>;

/** 编码一帧，`bytes` 由载荷长度决定。 */
export function encode_frame(header: ChannelHeader, payload?: Uint8Array): Buffer[] {
  const bytes = payload?.byteLength ?? 0;
  const head = Buffer.from(JSON.stringify({ ...header, bytes }));
  if (head.length > CHANNEL_HEADER_MAX)
    throw new Error(`Channel header is too long: ${head.length}`);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(head.length);
  return payload && bytes
    ? [prefix, head, Buffer.from(payload.buffer, payload.byteOffset, bytes)]
    : [prefix, head];
}

/** 增量解帧。管道分块与帧边界无关：帧头字节跨块累积，载荷直接拷入独立缓冲区。 */
export class FrameReader {
  private pending = Buffer.alloc(0); // 尚未凑齐的帧头字节。
  private header: ChannelHeader = {};
  private payload: Uint8Array<ArrayBuffer> | undefined; // 正在填充的载荷。
  private filled = 0;

  push(chunk: Buffer): ChannelFrame[] {
    const frames: ChannelFrame[] = [];
    let data = chunk;
    while (data.length) {
      if (this.payload) {
        const take = Math.min(this.payload.length - this.filled, data.length);
        this.payload.set(data.subarray(0, take), this.filled);
        this.filled += take;
        data = data.subarray(take);
      } else {
        this.pending = Buffer.concat([this.pending, data]);
        data = this.start();
      }
      if (this.payload && this.filled === this.payload.length) {
        frames.push({ header: this.header, payload: this.payload });
        this.payload = undefined;
      }
    }
    return frames;
  }

  /** 对端关闭时仍有残帧说明输出被截断。 */
  end(): void {
    if (this.payload || this.pending.length) throw new Error("Channel frame is truncated.");
  }

  /** 帧头完整时开始新帧，返回帧头之后的字节；否则继续等待。 */
  private start(): Buffer {
    if (this.pending.length < 4) return Buffer.alloc(0);
    const size = this.pending.readUInt32LE(0);
    if (size > CHANNEL_HEADER_MAX) throw new Error(`Channel header is too long: ${size}`);
    if (this.pending.length < 4 + size) return Buffer.alloc(0);
    const header: unknown = JSON.parse(this.pending.subarray(4, 4 + size).toString("utf8"));
    if (header === null || typeof header !== "object" || Array.isArray(header))
      throw new Error("Channel header must be an object.");
    const bytes = (header as { bytes?: unknown }).bytes ?? 0;
    if (
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > CHANNEL_PAYLOAD_MAX
    )
      throw new Error(`Channel payload size is invalid: ${String(bytes)}`);
    const rest = this.pending.subarray(4 + size);
    this.pending = Buffer.alloc(0);
    this.header = header as ChannelHeader;
    this.payload = new Uint8Array(bytes);
    this.filled = 0;
    return rest;
  }
}

/** 请求张量只允许 float32，形状乘积必须与字节数一致。 */
export function tensor_shape(header: ChannelHeader, bytes: number): number[] {
  const { dtype, shape } = header;
  if (dtype !== "float32") throw new Error(`Unsupported tensor dtype: ${String(dtype)}`);
  if (
    !Array.isArray(shape) ||
    shape.length === 0 ||
    !shape.every((value) => Number.isSafeInteger(value) && value > 0) ||
    4 * shape.reduce((total: number, value: number) => total * value, 1) !== bytes
  )
    throw new Error(`Tensor shape does not match ${bytes} bytes: ${JSON.stringify(shape)}`);
  return shape as number[];
}
