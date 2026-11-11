import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";

/** 固定版本的模型文件。同一行的地址必须是内容相同的镜像，由 aria2 按实际网络择优。 */
export type MediaModel = Readonly<{
  file: string;
  size: number;
  sha256: string;
  urls: readonly string[];
}>;

const W8A32 = "SenseVoiceSmall-ONNX-WebGPU-W8A32";
const W8A32_URLS = [
  `https://huggingface.co/neavo/${W8A32}/resolve/1006fa8a2b61075b3797ad211783caf418554b22`,
  `https://modelscope.cn/models/neavo7/${W8A32}/resolve/b41eb665cb5c93cfa72c6fbdda74a6c6bff13d36`,
];
const PPOCR_URLS = [
  "https://huggingface.co/neavo/PP-OCRv6-ONNX/resolve/f8d7df21b3cde6d331224b5728d7dffb8058b8d1",
  "https://modelscope.cn/models/neavo7/PP-OCRv6-ONNX/resolve/45e0cc57a4ea02feed488b5a0508257142a6009c",
];
const FSMN_URLS = [
  "https://huggingface.co/neavo/FSMN-VAD-ONNX/resolve/2baa9f06b5d56e871d3d30a4d9b9836bc5f141dd",
  "https://modelscope.cn/models/neavo7/FSMN-VAD-ONNX/resolve/3de348810c794315a5f36939717887df1b858af5",
];
const mirrors = (bases: readonly string[], file: string): string[] =>
  bases.map((base) => `${base}/${file}`);

/**
 * 模型清单。版本变化通过修改清单发布，启动时不追踪远端最新权重。
 * SenseVoiceSmall 来自阿里巴巴 FunASR，许可要求注明来源与作者并保留模型名。
 * FSMN-Monophone VAD 来自 Alibaba / FunASR，模型许可为 Apache-2.0。
 */
export const MEDIA_MODELS = Object.freeze({
  vad: {
    file: "fsmn_vad/model_quant.onnx",
    size: 506744,
    sha256: "5289eb2aa3c9af2d7a4284bcfa7c3ceb81d360814ed4203239b6c5d0569da8a1",
    urls: mirrors(FSMN_URLS, "model_quant.onnx"),
  },
  vad_mvn: {
    file: "fsmn_vad/am.mvn",
    size: 8040,
    sha256: "6820fef9687708c4fc3fab2530179c8fcea6262daa25514380056cd8f6eb1754",
    urls: mirrors(FSMN_URLS, "am.mvn"),
  },
  // CPU 使用官方动态 INT8 导出，镜像与官方源内容一致。
  asr_cpu: {
    file: "sensevoice/model_quant.onnx",
    size: 241216270,
    sha256: "21dc965f689a78d1604717bf561e40d5a236087c85a95584567835750549e822",
    urls: [
      "https://huggingface.co/neavo/SenseVoiceSmall-ONNX-CPU-INT8/resolve/0966ccc0e484cdaf4dc84ebecf049f0239a05901/model_quant.onnx",
      "https://modelscope.cn/models/neavo7/SenseVoiceSmall-ONNX-CPU-INT8/resolve/ef9414333f29e1c753b7dcfdf19a2c226e825dd4/model_quant.onnx",
    ],
  },
  // GPU 使用官方权重导出的 W8A32，与 CPU 权重共用词表与前处理。
  asr_gpu: {
    file: "sensevoice/model.w8a32.onnx",
    size: 267521956,
    sha256: "e6e4badd5ef43c545e09a940ac519928f39aea9a09935d00fa3495ae324b0229",
    urls: mirrors(W8A32_URLS, "model.w8a32.onnx"),
  },
  tokens: {
    file: "sensevoice/tokens.txt",
    size: 315894,
    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    urls: mirrors(W8A32_URLS, "tokens.txt"),
  },
  asr_mvn: {
    file: "sensevoice/am.mvn",
    size: 11203,
    sha256: "29b3c740a2c0cfc6b308126d31d7f265fa2be74f3bb095cd2f143ea970896ae5",
    urls: mirrors(W8A32_URLS, "am.mvn"), // 官方 iic/SenseVoiceSmall 同一文件的自有镜像。
  },
  det_cpu: {
    file: "ppocr/v6/PP-OCRv6_det_small.onnx",
    size: 9929594,
    sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    urls: mirrors(PPOCR_URLS, "det/PP-OCRv6_det_small.onnx"),
  },
  det_gpu: {
    file: "ppocr/v6/PP-OCRv6_det_medium.onnx",
    size: 62119454,
    sha256: "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    urls: mirrors(PPOCR_URLS, "det/PP-OCRv6_det_medium.onnx"),
  },
  rec_cpu: {
    file: "ppocr/v6/PP-OCRv6_rec_small.onnx",
    size: 21234383,
    sha256: "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    urls: mirrors(PPOCR_URLS, "rec/PP-OCRv6_rec_small.onnx"),
  },
  rec_gpu: {
    file: "ppocr/v6/PP-OCRv6_rec_medium.onnx",
    size: 76629984,
    sha256: "eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b",
    urls: mirrors(PPOCR_URLS, "rec/PP-OCRv6_rec_medium.onnx"),
  },
} satisfies Record<string, MediaModel>);

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

/** 快速检查文件大小。`download_model` 在复用和发布前校验内容。 */
export function model_ready(directory: string, model: MediaModel): boolean {
  const file = path.join(directory, model.file);
  return fs.exists(file) && fs.stat(file).size === model.size;
}

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
  model: MediaModel,
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
  model: MediaModel,
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
