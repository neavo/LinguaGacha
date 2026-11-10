/** 独立进程执行一次语音测量，正常退出后才接受结果。 */
import { spawn } from "node:child_process";
import { CLOSE_TIMEOUT_MS } from "./inference-engine";
import type { MediaCalibrationJob, MediaMeasurement } from "./worker-protocol";

const GAIN = 0.7; // GPU 首次推理耗时须至少降低 30%。
const CANDIDATE_TIMEOUT_MS = 180_000; // 包含模型加载，不能用 20 秒输入长度作为墙钟上限。
/** 子进程无法回收，调用方必须交由监管器结束本次运行。 */
export class CalibrationCleanupFailure extends Error {}

/** IPC 结果必须包含有效推理耗时，初始化和关闭单独计量。 */
export function valid_measurement(value: unknown): value is MediaMeasurement {
  if (!value || typeof value !== "object") return false;
  const data = value as MediaMeasurement;
  return (
    Number.isFinite(data.inference) &&
    data.inference > 0 &&
    Number.isFinite(data.prepare) &&
    data.prepare >= 0 &&
    Number.isFinite(data.close) &&
    data.close >= 0
  );
}

/** CPU 基线失败须暴露环境错误，GPU 缺失或收益不足则使用 CPU。 */
export function select_device(cpu: MediaMeasurement, gpu?: MediaMeasurement): "cpu" | "gpu" {
  if (!valid_measurement(cpu)) throw new Error("Invalid CPU calibration baseline.");
  return valid_measurement(gpu) && gpu.inference <= cpu.inference * GAIN ? "gpu" : "cpu";
}

/** 收到有效结果和正常 close 才接受。超时杀掉整个候选进程，等待其 Worker 一同结束。 */
export function run_calibration(file: string, job: MediaCalibrationJob): Promise<MediaMeasurement> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let result: MediaMeasurement | undefined, failure: Error | undefined;
    let cleanup: NodeJS.Timeout | undefined;
    const stop = (error: Error): void => {
      failure ??= error;
      clearTimeout(timer);
      child.kill();
      clearTimeout(cleanup);
      cleanup = setTimeout(
        () =>
          reject(
            new CalibrationCleanupFailure(
              "Calibration process could not be reaped; the host must end this run.",
              { cause: failure },
            ),
          ),
        CLOSE_TIMEOUT_MS,
      );
    };
    const timer = setTimeout(
      () => stop(new Error("Media calibration exceeded its time budget.")),
      CANDIDATE_TIMEOUT_MS,
    );
    child.on("error", stop);
    child.on("message", (value: unknown) => {
      if (result || !valid_measurement(value))
        return stop(new Error("Invalid media calibration result."));
      result = value;
      clearTimeout(timer);
      cleanup = setTimeout(
        () => stop(new Error("Media calibration returned results but did not close.")),
        CLOSE_TIMEOUT_MS,
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(cleanup);
      if (failure) reject(failure);
      else if (code !== 0 || !result)
        reject(new Error(`Media calibration closed without a valid result (${code}).`));
      else resolve(result);
    });
    child.send(job, (error) => {
      if (error) stop(error);
    });
  });
}
