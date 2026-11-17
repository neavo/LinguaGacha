import { spawn } from "node:child_process";
import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";

/**
 * 缺失时从主分支下载模型文件。
 * 首个地址提供 SHA-256，其余地址是相同内容的镜像。
 */
export type InferenceModel = Readonly<{
  file: string;
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
const METADATA_TIMEOUT_MS = 15_000; // 缺失模型读取远端哈希的单次时限。
const SHA256 = /^[a-f\d]{64}$/iu; // ModelScope `X-Linked-Etag` 的内容格式。

/** 同一准备锁保护整批模型和 aria2 速度记录，中断保留单文件续传材料。 */
export async function prepare_model_files(
  directory: string,
  cache: string,
  models: readonly InferenceModel[],
): Promise<void> {
  const missing = models.filter((model) => !model_exists(directory, model));
  if (missing.length === 0) return;
  await fs.make_dir_async(cache);
  console.log("模型准备：等待准备锁");
  const release = await lockfile.lock(path.join(cache, "prepare"), {
    realpath: false,
    retries: LOCK_RETRY,
  });
  try {
    for (const model of missing) {
      if (!model_exists(directory, model)) console.log(`模型准备：下载 ${model.file}`);
      await download_model(directory, path.join(cache, "aria2-server-stat.txt"), model);
    }
  } finally {
    await release();
  }
}

/** 目标文件只由校验成功的临时文件原子发布，存在即可沿用。 */
export function model_exists(directory: string, model: InferenceModel): boolean {
  return fs.exists(path.join(directory, model.file));
}

class ChecksumError extends Error {} // 仅触发逐镜像重试，普通网络错误保留断点数据。

/**
 * 在整批准备锁内下载并发布单个模型，开始前重新检查目标文件。
 * 仅缺失文件读取主分支哈希；临时文件按哈希命名，中断后可续传同一远端版本。
 * 校验失败时清理临时数据，依次单独使用每个镜像重新下载一次，确定可用来源。
 */
async function download_model(
  directory: string,
  stats: string,
  model: InferenceModel,
): Promise<void> {
  const target = path.join(directory, model.file);
  await fs.make_dir_async(path.dirname(target));
  if (model_exists(directory, model)) return;
  const sha256 = await read_remote_sha256(model);
  const temporary = `${target}.${sha256.slice(0, 16)}.part`;
  const clean = (): void => {
    fs.unlink(temporary, { force: true });
    fs.unlink(`${temporary}.aria2`, { force: true });
  };
  try {
    await aria2(temporary, stats, model, model.urls, sha256);
  } catch (error) {
    if (!(error instanceof ChecksumError)) throw error;
    let failure: unknown = error;
    for (const url of model.urls) {
      clean();
      try {
        await aria2(temporary, stats, model, [url], sha256);
        fs.rename(temporary, target);
        return;
      } catch (retry) {
        failure = retry;
      }
    }
    clean();
    throw failure;
  }
  fs.rename(temporary, target);
}

/** 首个镜像提供本次缺失文件的 SHA-256，已有文件不会访问远端。 */
async function read_remote_sha256(model: InferenceModel): Promise<string> {
  const url = model.urls[0]!;
  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Could not read model metadata (${response.status}): ${url}`);
  const sha256 = response.headers.get("x-linked-etag") ?? "";
  if (!SHA256.test(sha256)) throw new Error(`Model source did not provide SHA-256: ${url}`);
  return sha256.toLowerCase();
}

/** 同一文件的多个地址写在输入文件同一行，构成一个下载任务；输出转发到日志并保留尾部用于报错。 */
async function aria2(
  temporary: string,
  stats: string,
  model: InferenceModel,
  urls: readonly string[],
  sha256: string,
): Promise<void> {
  const input = `${temporary}.input`;
  if (!fs.exists(stats)) await fs.write_file(stats, ""); // 速度记录不存在时 aria2 会报读取错误。
  await fs.write_file(
    input,
    `${urls.join("\t")}\n  dir=${path.dirname(temporary)}\n  out=${path.basename(temporary)}\n  checksum=sha-256=${sha256}\n`,
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
