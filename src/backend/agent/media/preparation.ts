import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { uv } from "../uv";
import { CalibrationCleanupFailure } from "./calibration";
import {
  calibrate_devices,
  inference_cache,
  media_directories,
  ORT_PACKAGE,
  ORT_VERSION,
  probe_gpu,
  read_json,
} from "./engine";
import { FFMPEG_PACKAGE } from "./ffmpeg";
import { download_model, MEDIA_MODELS, model_ready, type MediaModel } from "./models";

/** 资源按用途准备：媒体读取、对白识别、画面文字检测、音频可视化。 */
export type MediaPurpose = "ffmpeg" | "speech" | "text" | "visualize";
export type MediaMissing = { packages: string[]; python: string[]; models: string[] };
/** 一种用途必需的 Python 依赖与 CPU 权重。带 `task` 的用途还需要 ORT 和本机推理校准。 */
type Resource = Readonly<{
  python: readonly string[];
  models: readonly MediaModel[];
  task?: "asr" | "det";
}>;
// Python 依赖固定为实测版本。
const NUMPY = "numpy==2.5.4";
const OPENCV = "opencv-python-headless==5.0.0.93";
const FFMPEG_RANGE = "^5.2.5"; // 每种用途都要读取媒体。
const GPU_MODELS = { asr: MEDIA_MODELS.asr_gpu, det: MEDIA_MODELS.det_gpu } as const; // 校准选中 GPU 时才需要。
const RESOURCES: Readonly<Record<MediaPurpose, Resource>> = {
  ffmpeg: { python: [], models: [] },
  speech: {
    python: [NUMPY, "kaldi-native-fbank==1.23.0"],
    task: "asr",
    models: [
      MEDIA_MODELS.vad,
      MEDIA_MODELS.vad_mvn,
      MEDIA_MODELS.vad_license,
      MEDIA_MODELS.asr_cpu,
      MEDIA_MODELS.tokens,
      MEDIA_MODELS.asr_mvn,
      MEDIA_MODELS.sensevoice_license,
    ],
  },
  text: {
    python: [NUMPY, OPENCV, "pyclipper==1.4.0"],
    task: "det",
    models: [MEDIA_MODELS.det_cpu, MEDIA_MODELS.ppocr_license],
  },
  visualize: { python: [NUMPY, OPENCV], models: [] },
};
const LOCK_RETRY = { retries: 1e6, minTimeout: 500, maxTimeout: 5000 }; // 等待其他准备完成，不设上限。

/** 校验调用者给出的用途并去重。用途来自模型编写的脚本，缺省或拼错时给出可读错误。 */
function resources(purposes: readonly MediaPurpose[]): Resource[] {
  if (
    !Array.isArray(purposes) ||
    !purposes.length ||
    purposes.some((purpose) => !Object.hasOwn(RESOURCES, purpose))
  )
    throw new Error("At least one valid media purpose is required.");
  return [...new Set<MediaPurpose>(purposes)].map((purpose) => RESOURCES[purpose]);
}

/** 列出用途尚缺的 npm 包、Python 依赖声明与模型。只读，不探测设备。 */
export async function missing(purposes: readonly MediaPurpose[]): Promise<MediaMissing> {
  const wanted = resources(purposes);
  const installed = (name: string) =>
    read_json(path.join(npm.directory, "node_modules", name, "package.json")) as
      | { version?: string }
      | undefined;
  const packages: string[] = [];
  if (!installed(FFMPEG_PACKAGE)) packages.push(`${FFMPEG_PACKAGE}@${FFMPEG_RANGE}`);
  if (wanted.some((resource) => resource.task) && installed(ORT_PACKAGE)?.version !== ORT_VERSION)
    packages.push(`${ORT_PACKAGE}@${ORT_VERSION}`);
  const specs = [...new Set(wanted.flatMap((resource) => resource.python))];
  const project = path.join(uv.directory, "pyproject.toml");
  const declared = specs.length && fs.exists(project) ? fs.read_text_file(project) : "";
  const python = specs.filter((spec) => !declared.includes(`"${spec}"`));
  const profile = wanted.some((resource) => resource.task) ? await inference_cache() : undefined;
  const models = wanted
    .flatMap((resource) => [
      ...resource.models,
      ...(resource.task && profile?.[resource.task] && profile[resource.task] !== "cpu"
        ? [GPU_MODELS[resource.task]]
        : []),
    ])
    .filter((model) => !model_ready(media_directories().models, model))
    .map((model) => model.file);
  return { packages, python, models };
}

/**
 * 安装用途所需依赖、下载并校验模型，只为其中的推理任务测量本机配置。
 * CPU 权重始终保留，GPU 在运行中出错时可直接回退。中断后重新调用即续传。
 */
export async function setup(purposes: readonly MediaPurpose[]): Promise<MediaMissing> {
  resources(purposes);
  const { runtime } = media_directories();
  await fs.make_dir_async(runtime);
  // 文件锁让同一进程和不同工作区的准备都串行。持锁后才计算缺口，后到的用途不会覆盖先到的校准。
  const release = await lockfile.lock(path.join(runtime, "prepare"), {
    realpath: false,
    retries: LOCK_RETRY,
  });
  try {
    return await prepare(purposes);
  } finally {
    await release();
  }
}

/** 按缺口安装依赖和 CPU 权重，再为尚未完成的推理任务探测 GPU 并校准。 */
async function prepare(purposes: readonly MediaPurpose[]): Promise<MediaMissing> {
  const wanted = resources(purposes);
  const { packages, python } = await missing(purposes);
  const ort = packages.filter((spec) => spec.startsWith(`${ORT_PACKAGE}@`));
  const others = packages.filter((spec) => !ort.includes(spec));
  if (others.length) await npm.run(["install", ...others]);
  // ORT 安装脚本只下载未使用的 CUDA，各平台二进制已在包内。
  if (ort.length) await npm.run(["install", "--ignore-scripts", "--save-exact", ...ort]);
  if (python.length) await uv.run(["add", ...python]);
  const { models, runtime } = media_directories();
  const stats = path.join(runtime, "aria2-server-stat.txt");
  for (const model of wanted.flatMap((resource) => resource.models))
    await download_model(models, stats, model);
  const cache = await inference_cache();
  const tasks = wanted
    .flatMap((resource) => (resource.task ? [resource.task] : []))
    .filter(
      (task) =>
        !cache?.complete.includes(task) ||
        (cache[task] !== "cpu" && !model_ready(models, GPU_MODELS[task])),
    );
  const gpu = new Set<"asr" | "det">();
  const failures: Record<string, string> = {};
  for (const task of tasks) {
    try {
      await probe_gpu(task);
      await download_model(models, stats, GPU_MODELS[task]);
      gpu.add(task);
    } catch (error) {
      if (error instanceof CalibrationCleanupFailure) throw error;
      failures[task] = error instanceof Error ? error.message : String(error);
      console.warn(`GPU ${task} 准备未完成，将验证 CPU 配置：${failures[task]}`);
    }
  }
  if (tasks.length) await calibrate_devices(tasks, gpu, failures);
  return missing(purposes);
}

/** 计算前确认用途资源齐全，缺失时提示先准备，不隐式下载或校准。 */
export async function ensure_ready(purposes: readonly MediaPurpose[]): Promise<void> {
  const { packages, python, models } = await missing(purposes);
  const optional = new Set(Object.values(GPU_MODELS).map((model) => model.file)); // 缺失时以 CPU 计算。
  const absent = [...packages, ...python, ...models.filter((file) => !optional.has(file))];
  if (absent.length)
    throw new Error(
      `Media components are not ready (${absent.join(", ")}); call media.setup(${JSON.stringify(purposes)}) first.`,
    );
}
