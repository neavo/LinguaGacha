import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { uv } from "../uv";
import { ORT_PACKAGE, ORT_VERSION } from "./engine";
import { media_configuration, MEDIA_PREPARE_LOCK_RETRY } from "./runtime";
import { FFMPEG_PACKAGE } from "./ffmpeg";
import { download_model, MEDIA_MODELS, model_ready } from "./models";

export type MediaMissing = { packages: string[]; python: string[]; models: string[] };
// 沿用已验收的 Python 依赖版本。
const PYTHON_PACKAGES = [
  "numpy==2.5.4",
  "kaldi-native-fbank==1.23.0",
  "opencv-python-headless==5.0.0.93",
  "pyclipper==1.4.0",
];
const FFMPEG_RANGE = "^5.2.5";

/** 读取可重建的安装元数据。缺失或损坏视为尚未安装，由准备入口修复。 */
function read_package(name: string): { version?: string } | undefined {
  try {
    return JSON.parse(
      fs.read_text_file(path.join(npm.directory, "node_modules", name, "package.json")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
}

/** 快速检查完整媒体环境。setup 负责复查模型内容。 */
export async function missing(): Promise<MediaMissing> {
  const packages: string[] = [];
  if (!read_package(FFMPEG_PACKAGE)) packages.push(`${FFMPEG_PACKAGE}@${FFMPEG_RANGE}`);
  if (read_package(ORT_PACKAGE)?.version !== ORT_VERSION)
    packages.push(`${ORT_PACKAGE}@${ORT_VERSION}`);
  const project = path.join(uv.directory, "pyproject.toml");
  const declared = fs.exists(project) ? fs.read_text_file(project) : "";
  const python = PYTHON_PACKAGES.filter((spec) => !declared.includes(`"${spec}"`));
  const models = Object.values(MEDIA_MODELS)
    .filter((model) => !model_ready(media_configuration().modelsDirectory, model))
    .map((model) => model.file);
  return { packages, python, models };
}

/** 一次准备完整环境，模型逐个校验复用，失败保留已完成资源供续传。 */
export async function setup(): Promise<MediaMissing> {
  const { cacheDirectory } = media_configuration();
  await fs.make_dir_async(cacheDirectory);
  console.log("媒体准备：等待准备锁");
  const release = await lockfile.lock(path.join(cacheDirectory, "prepare"), {
    realpath: false,
    retries: MEDIA_PREPARE_LOCK_RETRY,
  });
  try {
    const { packages, python } = await missing();
    const ort = packages.filter((spec) => spec.startsWith(`${ORT_PACKAGE}@`));
    const others = packages.filter((spec) => !ort.includes(spec));
    if (packages.length || python.length) console.log("媒体准备：下载并安装组件");
    if (others.length) await npm.run(["install", ...others]);
    // ORT 安装脚本下载未使用的 CUDA，平台二进制已随包提供。
    if (ort.length) await npm.run(["install", "--ignore-scripts", "--save-exact", ...ort]);
    if (python.length) await uv.run(["add", ...python]);
    const { modelsDirectory: models, cacheDirectory } = media_configuration();
    const stats = path.join(cacheDirectory, "aria2-server-stat.txt");
    for (const model of Object.values(MEDIA_MODELS)) {
      if (!model_ready(models, model)) console.log(`媒体准备：下载模型 ${model.file}`);
      await download_model(models, stats, model);
    }
    return missing();
  } finally {
    await release();
  }
}

/** 执行前检查统一环境。缺口交给调用者准备，避免计算时隐式下载。 */
export async function ensure_ready(): Promise<void> {
  const { packages, python, models } = await missing();
  const absent = [...packages, ...python, ...models];
  if (absent.length)
    throw new Error(
      `Media components are not ready (${absent.join(", ")}); call media.setup() first.`,
    );
}
