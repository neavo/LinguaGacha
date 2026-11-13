import { operate } from "./engine";
import { DeviceFailure } from "../inference/client";
import { require_models } from "./preparation";

export type GpuProbeResult =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: string }>;

const SHAPE = [1, 17, 560]; // 约一秒等效特征，只检查执行能力，不用于测速或识别质量判断。

/** 验证一次 WebGPU 配置推理及正常退出，不保证算子全在 GPU 或快于 CPU。 */
export async function probe_gpu(): Promise<GpuProbeResult> {
  require_models(["asr_gpu", "tokens"]);
  try {
    await operate(
      async (engine) => {
        const input = new Float32Array(SHAPE.reduce((size, n) => size * n, 1));
        for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * 0.37);
        await engine.request(
          0,
          "asr",
          { dtype: "float32", shape: SHAPE, language: "auto" },
          new Uint8Array(input.buffer),
        );
      },
      { device: "gpu" },
    );
    return { available: true };
  } catch (error) {
    if (!(error instanceof DeviceFailure)) throw error;
    return { available: false, reason: error.message };
  }
}
