import { spawn } from "node:child_process";
import { encode_frame, FrameReader, type ChannelHeader } from "./channel";
import { CLOSE_TIMEOUT_MS } from "./client";
let shutdown_failure: unknown; // helper 未确认退出时，阻止后续计算继续占用其资源。
/** 桥接固定 helper 的推理请求，返回前等待进程及全部在途作业收尾。 */
export async function run_helper(
  executable: string,
  module: string,
  command: string,
  job: Readonly<Record<string, unknown>>,
  infer?: (
    header: ChannelHeader,
    payload: Uint8Array<ArrayBuffer>,
  ) => Promise<{ header: ChannelHeader; payload?: ArrayBuffer }>,
): Promise<unknown> {
  if (shutdown_failure) throw shutdown_failure;
  // 作业正文走载荷；启动前完成编码，非法输入不能留下等待首帧的子进程。
  const request = encode_frame({ command }, Buffer.from(JSON.stringify(job)));
  // -I 隔离宿主配置，-B 保护应用源码，-X utf8 让日志在任何代码页下都是 UTF-8。
  const child = spawn(executable, ["-I", "-B", "-X", "utf8", "-m", module], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const reader = new FrameReader();
  const operations = new Set<Promise<void>>(); // helper 提前退出也必须等待所有原生作业实际收尾。
  let result: { value: unknown } | undefined, failure: unknown;
  let stopping: NodeJS.Timeout | undefined;
  const fail = (error: unknown): void => {
    failure ??= error;
    child.kill();
  };
  const write = (header: ChannelHeader, payload?: ArrayBuffer): void => {
    if (child.stdin.writable)
      for (const part of encode_frame(header, payload && new Uint8Array(payload)))
        child.stdin.write(part);
  };
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  child.once("error", fail);
  child.stdin.on("error", fail);
  child.stdout.on("data", (chunk: Buffer) => {
    try {
      for (const { header, payload } of reader.push(chunk)) {
        if ("error" in header) {
          fail(new Error(String(header.error)));
          continue;
        }
        if ("result" in header) {
          result = { value: JSON.parse(Buffer.from(payload).toString("utf8")) };
          child.stdin.end(); // helper 的读线程随 EOF 结束后自然退出。
          stopping ??= setTimeout(() => {
            shutdown_failure = new Error(
              "Inference helper did not close; the host must end this run.",
            );
            child.kill();
          }, CLOSE_TIMEOUT_MS);
          continue;
        }
        const { id } = header;
        if (!infer)
          throw new Error(`Unexpected inference helper request: ${JSON.stringify(header)}`);
        const operation = infer(header, payload)
          .then(
            (reply) => write({ ...reply.header, id }, reply.payload),
            (error: unknown) => {
              failure ??= error;
              write({ id, error: error instanceof Error ? error.message : String(error) });
              // 先让 helper 完成自身 finally，再判断其是否按时退出。
              stopping ??= setTimeout(() => {
                shutdown_failure = new Error(
                  "Inference helper did not close; the host must end this run.",
                  { cause: failure },
                );
                child.kill();
              }, CLOSE_TIMEOUT_MS);
            },
          )
          .catch(fail)
          .finally(() => operations.delete(operation));
        operations.add(operation);
      }
    } catch (error) {
      fail(error);
    }
  });
  try {
    for (const part of request) child.stdin.write(part);
  } catch (error) {
    fail(error);
  }
  const code = await closed;
  await Promise.allSettled(operations);
  clearTimeout(stopping);
  if (shutdown_failure) throw shutdown_failure;
  if (failure === undefined)
    try {
      reader.end();
    } catch (error) {
      failure = error;
    }
  if (failure !== undefined) throw failure;
  if (code !== 0 || !result) throw new Error(`${module} ${command} failed (${code}); see the log.`);
  return result.value;
}
