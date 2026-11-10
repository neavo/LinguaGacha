import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { run_calibration, select_device, valid_measurement } from "./calibration";
import type { MediaCalibrationJob, MediaMeasurement } from "./worker-protocol";

const measured = (inference: number): MediaMeasurement => ({ inference, prepare: 1, close: 1 });

it("uses the inclusive 30 percent threshold and rejects invalid measurements", () => {
  expect(select_device(measured(100), measured(70))).toBe("gpu");
  expect(select_device(measured(100), measured(70.01))).toBe("cpu");
  expect(select_device(measured(100))).toBe("cpu");
  expect(() => select_device(measured(0))).toThrow("CPU");
  expect(valid_measurement(measured(NaN))).toBe(false);
  expect(valid_measurement({ ...measured(1), close: -1 })).toBe(false);
});

it("accepts calibration only after valid data and successful process close", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "media calibration "));
  const file = path.join(directory, "candidate.mjs");
  const model = { file, device: "cpu", threads: 4 } as const;
  const job: MediaCalibrationJob = {
    worker: file,
    config: {
      ort: pathToFileURL(file).href,
      tokens: file,
      models: { vad: model, asr: model, det: model },
    },
  };
  const value = measured(1);
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
