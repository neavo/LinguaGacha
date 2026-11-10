/** 父进程侧的校准：启动候选子进程、接受测量结果并选择本机配置。 */
import { spawn } from "node:child_process";
import { CLOSE_TIMEOUT_MS } from "./inference-engine";
import type {
  MediaCalibration,
  MediaCalibrationJob,
  MediaMeasurement,
  MediaProfile,
} from "./worker-protocol";

const GAIN = 0.85; // GPU 平均耗时须不高于对照的 85%，抑制测量噪声。
const CANDIDATE_TIMEOUT_MS = 180_000; // 单个候选从启动到给出结果的上限。
/** 校准子进程无法回收。父进程不能继续下一个候选，由工作区监管器结束本次运行。 */
export class CalibrationCleanupFailure extends Error {}
/** 上中位数，偶数个时取较大的一个。 */
const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!;

/** 跨进程收到的测量须是两个输入档、每档至少三批的正数耗时。 */
export function valid_measurement(value: unknown): value is MediaMeasurement {
  if (!value || typeof value !== "object") return false;
  const data = value as MediaMeasurement;
  return (
    Number.isFinite(data.prepare) &&
    data.prepare >= 0 &&
    Number.isFinite(data.close) &&
    data.close >= 0 &&
    Array.isArray(data.timings) &&
    data.timings.length === 2 &&
    data.timings.every(
      (row) =>
        Array.isArray(row) &&
        row.length >= 3 &&
        row.every((time) => Number.isFinite(time) && time > 0),
    )
  );
}

/** 候选至少有一次有效测量。 */
function valid_runs(
  value: readonly MediaMeasurement[] | undefined,
): value is readonly MediaMeasurement[] {
  return Array.isArray(value) && value.length > 0 && value.every(valid_measurement);
}

/** 两档相对耗时都不慢于对照，且等权平均达到收益门槛。 */
function faster(
  candidate: readonly MediaMeasurement[] | undefined,
  baseline: readonly MediaMeasurement[],
): boolean {
  if (!valid_runs(candidate)) return false;
  const ratios = [0, 1].map(
    (slot) =>
      median(candidate.flatMap((run) => [...run.timings[slot]!])) /
      median(baseline.flatMap((run) => [...run.timings[slot]!])),
  );
  return (
    ratios.every((ratio) => ratio <= 1) &&
    ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length <= GAIN
  );
}

/**
 * CPU 是基线。检测双路须同时快于 CPU 和单路才采用，只有一种 GPU 方案合格时直接采用它。
 * CPU 基线无效说明基础配置故障，不能静默选择 CPU。
 * 只校验 `tasks` 中任务的基线，未准备的任务取 CPU。
 */
export function select_profile(
  results: MediaCalibration,
  tasks: readonly ("asr" | "det")[] = ["asr", "det"],
): MediaProfile {
  const cpu_asr = results.asr.cpu,
    cpu_det = results.det.cpu;
  if (
    (tasks.includes("asr") && !valid_runs(cpu_asr)) ||
    (tasks.includes("det") && !valid_runs(cpu_det))
  )
    throw new Error("Invalid CPU calibration baseline.");
  const single = results.det.webgpu_single,
    dual = results.det.webgpu_dual;
  const one = tasks.includes("det") && faster(single, cpu_det!),
    two = tasks.includes("det") && faster(dual, cpu_det!);
  return {
    asr: tasks.includes("asr") && faster(results.asr.webgpu, cpu_asr!) ? "webgpu" : "cpu",
    det: two && (!one || faster(dual, single!)) ? "webgpu_dual" : one ? "webgpu_single" : "cpu",
  };
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
