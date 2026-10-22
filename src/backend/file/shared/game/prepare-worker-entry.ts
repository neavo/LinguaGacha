import { configure_python_parser } from "../../renpy/python-syntax";
import { parentPort, workerData } from "node:worker_threads";
import { default_native_fs } from "../../../../native/native-fs";
import { to_log_error } from "../../../../shared/error";
import { stage_game_source } from "./prepare-worker";
import type { GamePrepareTask, GamePrepareResponse } from "./prepare-worker";

const port = parentPort!;
const controller = new AbortController();
port.on("message", () => controller.abort());
try {
  const data = workerData as { task: GamePrepareTask; workspaceRuntimeDirectory?: string };
  if (data.workspaceRuntimeDirectory) configure_python_parser(data.workspaceRuntimeDirectory);
  const result = await stage_game_source(data.task, default_native_fs, controller.signal);
  port.postMessage({ result } satisfies GamePrepareResponse);
} catch (error) {
  port.postMessage({ error: to_log_error(error) } satisfies GamePrepareResponse);
} finally {
  port.close();
}
