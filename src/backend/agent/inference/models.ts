import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";

/** 固定版本的模型文件。同一行的地址必须是内容相同的镜像，由 aria2 按实际网络择优。 */
export type InferenceModel = Readonly<{
  file: string;
  size: number;
  sha256: string;
  urls: readonly string[];
}>;

// 初始值待真实镜像实测：小文件为主，2 条连接、每服务器 1 条，不设最低速度门槛。
const ARIA2_OPTIONS = Object.freeze([
  "--no-conf",
  "--continue=true",
  "--auto-file-renaming=false",
  "--allow-overwrite=true",
  "--check-integrity=true",
  "--uri-selector=adaptive",
  "--split=2",
  "--max-connection-per-server=1",
  "--min-split-size=4M",
  "--connect-timeout=5",
  "--timeout=15",
  "--max-tries=2",
  "--retry-wait=1",
  "--server-stat-timeout=86400", // 速度记录一天过期，只影响地址优先级。
  "--file-allocation=none",
  "--summary-interval=5",
  "--console-log-level=warn",
  "--enable-color=false",
]);
const ARIA2_CHECKSUM_FAILED = 32; // aria2 退出码：下载完成但校验和不符。
const OUTPUT_TAIL = 16 * 1024; // 失败时保留的 aria2 输出尾部。
const LOCK_RETRY = Object.freeze({ retries: 1e6, minTimeout: 500, maxTimeout: 5000 }); // 等待其它进程完成同一资源。

/** 同一准备锁保护整批模型和 aria2 速度记录，中断保留单文件续传材料。 */
export async function prepare_model_files(
  directory: string,
  cache: string,
  models: readonly InferenceModel[],
): Promise<void> {
  await fs.make_dir_async(cache);
  console.log("模型准备：等待准备锁");
  const release = await lockfile.lock(path.join(cache, "prepare"), {
    realpath: false,
    retries: LOCK_RETRY,
  });
  try {
    for (const model of models) {
      if (!model_ready(directory, model)) console.log(`模型准备：下载 ${model.file}`);
      await download_model(directory, path.join(cache, "aria2-server-stat.txt"), model);
    }
  } finally {
    await release();
  }
}

/** 快速检查文件大小。`download_model` 在复用和发布前校验内容。 */
export function model_ready(directory: string, model: InferenceModel): boolean {
  const file = path.join(directory, model.file);
  return fs.exists(file) && fs.stat(file).size === model.size;
}

/** 流式校验模型文件，避免加载权重之外再持有一份完整字节。 */
async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.create_read_stream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

class ChecksumError extends Error {}

/**
 * 下载并发布单个模型。同一资源用文件锁互斥，取得锁后重新检查。
 * 临时文件按哈希命名，清单换版后不会续传旧内容；中断保留临时文件与 aria2 控制文件供续传。
 * 校验失败时清理临时数据，依次单独使用每个镜像重新下载一次，确定可用来源。
 */
export async function download_model(
  directory: string,
  stats: string,
  model: InferenceModel,
): Promise<void> {
  const target = path.join(directory, model.file);
  await fs.make_dir_async(path.dirname(target));
  const release = await lockfile.lock(target, { realpath: false, retries: LOCK_RETRY });
  try {
    if (model_ready(directory, model) && (await sha256(target)) === model.sha256) return;
    fs.unlink(target, { force: true }); // 大小或内容不符的旧文件不能作为续传基础。
    const temporary = `${target}.${model.sha256.slice(0, 16)}.part`;
    const clean = (): void => {
      fs.unlink(temporary, { force: true });
      fs.unlink(`${temporary}.aria2`, { force: true });
    };
    try {
      await aria2(temporary, stats, model, model.urls);
    } catch (error) {
      if (!(error instanceof ChecksumError)) throw error;
      const failures: unknown[] = [error];
      for (const url of model.urls) {
        clean();
        try {
          await aria2(temporary, stats, model, [url]);
          failures.length = 0;
          break;
        } catch (retry) {
          failures.push(retry);
        }
      }
      if (failures.length) {
        clean();
        throw new AggregateError(
          failures,
          `No source provided the expected content of ${model.file}.`,
        );
      }
    }
    fs.rename(temporary, target);
  } finally {
    await release();
  }
}

/** 同一文件的多个地址写在输入文件同一行，构成一个下载任务；输出转发到日志并保留尾部用于报错。 */
async function aria2(
  temporary: string,
  stats: string,
  model: InferenceModel,
  urls: readonly string[],
): Promise<void> {
  const input = `${temporary}.input`;
  if (!fs.exists(stats)) await fs.write_file(stats, ""); // 速度记录不存在时 aria2 会报读取错误。
  await fs.write_file(
    input,
    `${urls.join("\t")}\n  dir=${path.dirname(temporary)}\n  out=${path.basename(temporary)}\n  checksum=sha-256=${model.sha256}\n`,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      let tail = "";
      const child = spawn(
        "aria2c",
        [
          ...ARIA2_OPTIONS,
          `--server-stat-if=${stats}`,
          `--server-stat-of=${stats}`,
          `--input-file=${input}`,
        ],
        { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const forward = (target: NodeJS.WriteStream) => (chunk: Buffer) => {
        target.write(chunk);
        tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL);
      };
      child.stdout.on("data", forward(process.stdout));
      child.stderr.on("data", forward(process.stderr));
      child.once("error", (cause) => reject(new Error("aria2c could not start.", { cause })));
      child.once("close", (exitCode) => {
        if (exitCode === 0) resolve();
        else if (exitCode === ARIA2_CHECKSUM_FAILED)
          reject(new ChecksumError(`Checksum mismatch for ${model.file}: ${urls.join(" | ")}`));
        else
          reject(
            new Error(
              `Download of ${model.file} failed (aria2 ${exitCode}): ${urls.join(" | ")}\n${tail}`,
            ),
          );
      });
    });
  } finally {
    fs.unlink(input, { force: true });
  }
}
