import { InferenceClient } from "../inference/client";
import type { ChannelHeader } from "../inference/channel";
import type { MediaTask, MediaWorkerConfig } from "./worker-protocol";

/** 单次媒体作业的推理路由，共享客户端负责传输和线程收尾。 */
export class Engine {
  private readonly client: InferenceClient;
  private vision = 0; // 检测与识别共用两条 CPU 视觉通道。
  /** 配置跟随单次操作，客户端按首次请求创建对应 Worker。 */
  constructor(
    private readonly config: MediaWorkerConfig,
    worker_file: string,
  ) {
    this.client = new InferenceClient(config, worker_file);
  }
  /** 媒体决定路由，共享客户端只关联请求与应答。 */
  request(kind: MediaTask, header: ChannelHeader, payload: Uint8Array<ArrayBuffer>) {
    const lane =
      this.config.models[kind].device === "webgpu"
        ? "gpu"
        : kind === "detection" || kind === "recognition"
          ? `vision${this.vision++ % 2}`
          : "audio";
    return this.client.request(lane, { kind }, header, payload);
  }
  /** 实际线程退出后才完成领域操作。 */
  close(): Promise<void> {
    return this.client.close();
  }
}
