import { parentPort, workerData } from "node:worker_threads";
import { default_native_fs } from "../../../native/native-fs";
import { to_log_error } from "../../../shared/error";
import { stage_rpgmaker_source } from "./prepare";
import type { RPGMakerMvMzPrepareTask, RPGMakerMvMzPrepareResponse } from "./prepare-worker";

const port = parentPort!;
const controller = new AbortController();
port.on("message", () => controller.abort());
try {
  const result = await stage_rpgmaker_source(
    workerData as RPGMakerMvMzPrepareTask,
    default_native_fs,
    controller.signal,
  );
  port.postMessage({ result } satisfies RPGMakerMvMzPrepareResponse);
} catch (error) {
  port.postMessage({ error: to_log_error(error) } satisfies RPGMakerMvMzPrepareResponse);
} finally {
  port.close();
}
