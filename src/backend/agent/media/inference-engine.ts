import { Worker } from "node:worker_threads";
import type { ChannelHeader } from "./channel";
import type {
  MediaTask,
  MediaWorkerConfig,
  MediaWorkerReply,
  MediaWorkerRequest,
} from "./worker-protocol";

/** 资源收尾的统一等待上限。超时说明原生或子进程收尾卡住，只能交给工作区监管器。 */
export const CLOSE_TIMEOUT_MS = 30_000;

/** GPU 通道执行失败。调用者在安全收尾后决定是否改用 CPU。 */
export class DeviceFailure extends Error {
  override name = "DeviceFailure";
}

/** 派发通道：`audio`（CPU 音频）、`gpu`、`det0`、`det1`（CPU 检测），各对应一个 Worker。 */
type Lane = string;

/** 正式执行与 GPU 探查共用的路由和生命周期。 */
export class Engine {
  private readonly workers = new Map<Lane, Readonly<{ worker: Worker; exited: Promise<number> }>>();
  private readonly pending = new Map<
    number,
    Readonly<{
      lane: Lane;
      resolve: (reply: Reply) => void;
      reject: (error: Error) => void;
    }>
  >();
  private next = 0; // 请求编号，只用于关联应答。
  private detection = 0; // 检测请求自己的轮转序号，不受音频请求穿插影响。
  private streams = 0; // 已分配的 helper 流编号。
  private failure: Error | undefined; // 首个致命错误，之后的请求直接拒绝。
  private closing: Promise<void> | undefined;
  private shutdown_error: Error | undefined; // 关闭期间 Worker 报出的错误。

  /** 保存独立执行配置，首次请求才创建 Worker。 */
  constructor(
    private readonly config: MediaWorkerConfig,
    private readonly worker_file: string,
  ) {}

  /** WebGPU 共用单通道，CPU 检测双路按检测序号轮转。 */
  private lane(kind: MediaTask): Lane {
    if (this.config.models[kind].device === "webgpu") return "gpu";
    if (kind === "det") return `det${this.detection++ % 2}`;
    return "audio";
  }

  /** 通道的 Worker 按需创建。非关闭期间的退出或错误都使整个引擎失败。 */
  private worker(lane: Lane): Worker {
    let current = this.workers.get(lane);
    if (!current) {
      const worker = new Worker(this.worker_file, { workerData: this.config });
      const exited = new Promise<number>((resolve) => worker.once("exit", resolve));
      worker.on("message", (reply: MediaWorkerReply) => this.settle(reply));
      worker.on("error", (error) => {
        if (this.closing) this.shutdown_error ??= error;
        this.fail(this.attribute(lane, error));
      });
      void exited.then((code) => {
        if (!this.closing || code !== 0)
          this.fail(this.attribute(lane, new Error(`Media inference worker exited (${code}).`)));
      });
      current = { worker, exited };
      this.workers.set(lane, current);
    }
    return current.worker;
  }

  /** 为一个 helper 分配流编号，区分各路 VAD 状态。 */
  open(): number {
    return this.streams++;
  }

  /** helper 结束后丢弃它的 VAD 循环状态。 */
  release(stream: number): void {
    if (!this.failure) this.workers.get("audio")?.worker.postMessage({ type: "release", stream });
  }

  /** 载荷所在的 ArrayBuffer 转移给 Worker，调用者之后不能再使用它。 */
  request(
    stream: number,
    kind: MediaTask,
    header: ChannelHeader,
    payload: Uint8Array<ArrayBuffer>,
  ): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing) return Promise.reject(new Error("Media engine is closing."));
    if (payload.byteOffset !== 0 || payload.byteLength !== payload.buffer.byteLength)
      throw new Error("Media payload must own its buffer.");
    const id = this.next++;
    const lane = this.lane(kind);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { lane, resolve, reject });
      const message: MediaWorkerRequest = {
        type: "infer",
        id,
        stream,
        kind,
        header,
        payload: payload.buffer,
      };
      try {
        this.worker(lane).postMessage(message, [payload.buffer]);
      } catch (error) {
        this.fail(this.attribute(lane, error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  /** 关闭只发生一次：请求释放会话，等待线程自然退出。 */
  close(): Promise<void> {
    this.closing ??= (async () => {
      const close: MediaWorkerRequest = { type: "close" };
      for (const { worker } of this.workers.values()) worker.postMessage(close); // 已退出的 Worker 忽略消息。
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        Promise.all([...this.workers.values()].map(({ exited }) => exited)),
        timeout,
      ]);
      clearTimeout(timer);
      if (outcome === "timeout") {
        throw new Error(
          `Media inference worker did not exit within ${CLOSE_TIMEOUT_MS / 1000}s; the host must end this run.`,
        );
      }
      if (this.shutdown_error) throw this.shutdown_error;
      if (!this.failure && outcome.some((code) => code !== 0))
        throw new Error(`Media workers failed to close: ${outcome}`);
    })();
    return this.closing;
  }

  /** 应答按编号交还等待者。GPU 通道的失败应答同时使引擎失败。 */
  private settle(reply: MediaWorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return this.fail(new Error(`Unknown media worker reply: ${reply.id}`));
    this.pending.delete(reply.id);
    if ("error" in reply) {
      const error = this.attribute(pending.lane, new Error(reply.error));
      pending.reject(error);
      if (error instanceof DeviceFailure) this.fail(error);
    } else pending.resolve(reply);
  }

  /** 只把 GPU 通道错误标记为设备失败，CPU 错误保持原样。 */
  private attribute(lane: Lane, error: Error): Error {
    if (lane !== "gpu") return error;
    return new DeviceFailure(error.message, { cause: error });
  }

  /** 记录首个失败，拒绝全部在途请求并开始关闭。 */
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    // 调用方在关闭引擎时收到收尾结果，这里只避免未处理的拒绝。
    this.close().catch(() => undefined);
  }
}

/** 成功应答：结果头与可选的二进制载荷。 */
type Reply = Readonly<{ header: ChannelHeader; payload?: ArrayBuffer }>;
