import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { run_calibration, select_profile, valid_measurement } from "./calibration";
import type { MediaCalibrationJob, MediaMeasurement } from "./worker-protocol";

const measured = (short: number, long = short): MediaMeasurement[] => [
  {
    timings: [
      [short, short, short],
      [long, long, long],
    ],
    prepare: 1,
    close: 1,
  },
];

it("compares complete candidates across both input sizes", () => {
  const calibration = {
    asr: { cpu: measured(100), webgpu: measured(80) },
    det: { cpu: measured(100), webgpu_single: measured(80), webgpu_dual: measured(70) },
  };
  expect(select_profile(calibration)).toEqual({ asr: "webgpu", det: "webgpu_single" });
  calibration.det.webgpu_dual = measured(60);
  expect(select_profile(calibration).det).toBe("webgpu_dual");
  calibration.det.webgpu_single = measured(90);
  expect(select_profile(calibration).det).toBe("webgpu_dual");
  calibration.det.webgpu_dual = measured(50, 101);
  expect(select_profile(calibration).det).toBe("cpu");
  expect(select_profile({ asr: { cpu: measured(100) }, det: { cpu: measured(100) } })).toEqual({
    asr: "cpu",
    det: "cpu",
  });
});

it("rejects a failed CPU baseline and malformed timings", () => {
  expect(() => select_profile({ asr: {}, det: { cpu: measured(100) } })).toThrow("CPU");
  expect(valid_measurement(measured(NaN)[0])).toBe(false);
  expect(valid_measurement(measured(0)[0])).toBe(false);
  expect(valid_measurement({ timings: [[1]], prepare: 0, close: 0 })).toBe(false);
});

it("selects speech without claiming a detector baseline and validates only requested tasks", () => {
  const partial = { asr: { cpu: measured(100), webgpu: measured(70) }, det: {} };
  expect(select_profile(partial, ["asr"])).toEqual({ asr: "webgpu", det: "cpu" });
  expect(() => select_profile(partial, ["det"])).toThrow("CPU");
});

it("accepts calibration only after valid data and successful process close", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "media calibration "));
  const file = path.join(directory, "candidate.mjs");
  const model = { file, device: "cpu", threads: 4 } as const;
  const job: MediaCalibrationJob = {
    task: "det",
    profile: { asr: "cpu", det: "cpu" },
    worker: file,
    config: {
      ort: pathToFileURL(file).href,
      tokens: file,
      models: { vad: model, asr: model, det: model },
    },
  };
  const value = measured(1)[0]!;
  const send = `process.once('message',()=>process.send(${JSON.stringify(value)}`;
  try {
    // 子进程夹具只观察父进程的完成契约，不消费生产配置。
    await writeFile(file, `${send},()=>{process.exitCode=1;process.disconnect();}));`);
    await expect(run_calibration(file, job)).rejects.toThrow("closed without a valid result");
    await writeFile(file, `${send},()=>process.disconnect()));`);
    await expect(run_calibration(file, job)).resolves.toEqual(value);
    await writeFile(file, `${send}));setInterval(()=>{},1000);`);
    await expect(run_calibration(file, job)).rejects.toThrow("did not close");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 40_000);
