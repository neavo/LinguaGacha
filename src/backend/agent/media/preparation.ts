import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { uv } from "../uv";
import type { DeviceOptions } from "./worker-protocol";
import {
  calibrate_devices,
  inference_cache,
  ORT_PACKAGE,
  ORT_VERSION,
  validate_device,
  read_json,
} from "./engine";
import { media_configuration, MEDIA_PREPARE_LOCK_RETRY } from "./runtime";
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
const GPU_MODELS = { asr: MEDIA_MODELS.asr_gpu, det: MEDIA_MODELS.det_gpu } as const; // 显式 GPU 或自动检查通过时准备。
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
export async function missing(
  purposes: readonly MediaPurpose[],
  { device }: DeviceOptions = {},
): Promise<MediaMissing> {
  validate_device(device);
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
  const cache = wanted.some((resource) => resource.task) ? await inference_cache() : undefined;
  const models = required_models(wanted, device ?? cache?.device)
    .filter((model) => !model_ready(media_configuration().modelsDirectory, model))
    .map((model) => model.file);
  return { packages, python, models };
}

/** 未确定默认设备时准备语音检查资源，其他情况只补所选设备的模型。 */
function required_models(wanted: Resource[], device: DeviceOptions["device"]): MediaModel[] {
  const inference = wanted.some((resource) => resource.task);
  const benchmark = inference && device === undefined;
  return [
    ...new Set([
      ...wanted.flatMap((resource) => resource.models),
      ...(benchmark
        ? [
            MEDIA_MODELS.asr_cpu,
            MEDIA_MODELS.asr_gpu,
            MEDIA_MODELS.tokens,
            MEDIA_MODELS.sensevoice_license,
          ]
        : []),
      ...wanted.flatMap((resource) =>
        resource.task && device === "gpu" ? [GPU_MODELS[resource.task]] : [],
      ),
    ]),
  ];
}

/** 准备资源并发布默认配置。保留 CPU 权重供故障回退。 */
export async function setup(
  purposes: readonly MediaPurpose[],
  options: DeviceOptions = {},
): Promise<MediaMissing> {
  resources(purposes);
  validate_device(options.device);
  const { cacheDirectory } = media_configuration();
  await fs.make_dir_async(cacheDirectory);
  console.log("媒体准备：等待准备锁");
  const release = await lockfile.lock(path.join(cacheDirectory, "prepare"), {
    realpath: false,
    retries: MEDIA_PREPARE_LOCK_RETRY,
  });
  try {
    return await prepare(purposes, options);
  } finally {
    await release();
  }
}

/** 持锁后重新计算缺口，CPU 资源先于可选 GPU 资源就绪。 */
async function prepare(
  purposes: readonly MediaPurpose[],
  options: DeviceOptions,
): Promise<MediaMissing> {
  const wanted = resources(purposes);
  const { packages, python } = await missing(purposes, options);
  const ort = packages.filter((spec) => spec.startsWith(`${ORT_PACKAGE}@`));
  const others = packages.filter((spec) => !ort.includes(spec));
  if (packages.length || python.length) console.log("媒体准备：下载并安装组件");
  if (others.length) await npm.run(["install", ...others]);
  // ORT 安装脚本下载未使用的 CUDA，平台二进制已随包提供。
  if (ort.length) await npm.run(["install", "--ignore-scripts", "--save-exact", ...ort]);
  if (python.length) await uv.run(["add", ...python]);
  const { modelsDirectory: models, cacheDirectory } = media_configuration();
  const stats = path.join(cacheDirectory, "aria2-server-stat.txt");
  const prepared = new Set<MediaModel>(); // 同一次准备只校验每个模型一次。
  const download = async (model: MediaModel): Promise<void> => {
    if (prepared.has(model)) return;
    if (!model_ready(models, model)) console.log(`媒体准备：下载模型 ${model.file}`);
    await download_model(models, stats, model);
    prepared.add(model);
  };
  // 先完成 CPU 资源，即使可选 GPU 下载失败也能运行。
  for (const model of new Set(wanted.flatMap((resource) => resource.models))) await download(model);
  let cache = await inference_cache();
  try {
    for (const model of required_models(wanted, options.device ?? cache?.device))
      await download(model);
  } catch (error) {
    if (options.device !== undefined) throw error;
    console.warn(`媒体 GPU 资源准备未完成，本次可用 CPU，下次 setup 续传：${String(error)}`);
    return missing(purposes, options);
  }
  if (wanted.some((resource) => resource.task) && options.device === undefined && !cache) {
    await calibrate_devices();
    cache = await inference_cache();
  }
  try {
    for (const model of required_models(wanted, options.device ?? cache?.device))
      await download(model);
  } catch (error) {
    if (options.device !== undefined) throw error;
    console.warn(`媒体 GPU 模型准备未完成，本次可用 CPU，下次 setup 续传：${String(error)}`);
  }
  return missing(purposes, options);
}

/** 计算只检查实际必需的资源，不下载、不校准。 */
export async function ensure_ready(
  purposes: readonly MediaPurpose[],
  options: DeviceOptions = {},
): Promise<void> {
  const { packages, python, models } = await missing(purposes, { device: options.device ?? "cpu" });
  const absent = [...packages, ...python, ...models];
  if (absent.length)
    throw new Error(
      `Media components are not ready (${absent.join(", ")}); call media.setup(${JSON.stringify(purposes)}, ${JSON.stringify(options)}) first.`,
    );
}
