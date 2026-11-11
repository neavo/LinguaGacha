import path from "node:path";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";
import { media_configuration, MEDIA_PREPARE_LOCK_RETRY } from "./runtime";
import { download_model, MEDIA_MODELS, model_ready } from "./models";

type ModelKey = keyof typeof MEDIA_MODELS;

/** 按文件大小列出缺失模型，不校验内容。`prepare_models` 负责完整校验。 */
export async function missing_models(): Promise<string[]> {
  const { modelsDirectory } = media_configuration();
  return Object.values(MEDIA_MODELS)
    .filter((model) => !model_ready(modelsDirectory, model))
    .map((model) => model.file);
}

/**
 * 逐个校验、复用或下载全部模型，返回剩余缺口。失败保留已完成资源供续传。
 * 准备锁同时保护各模型共用的 aria2 服务器速度记录。
 */
export async function prepare_models(): Promise<string[]> {
  const { modelsDirectory, cacheDirectory } = media_configuration();
  await fs.make_dir_async(cacheDirectory);
  console.log("模型准备：等待准备锁");
  const release = await lockfile.lock(path.join(cacheDirectory, "prepare"), {
    realpath: false,
    retries: MEDIA_PREPARE_LOCK_RETRY,
  });
  try {
    const stats = path.join(cacheDirectory, "aria2-server-stat.txt");
    for (const model of Object.values(MEDIA_MODELS)) {
      if (!model_ready(modelsDirectory, model)) console.log(`模型准备：下载 ${model.file}`);
      await download_model(modelsDirectory, stats, model);
    }
    return await missing_models();
  } finally {
    await release();
  }
}

/**
 * 计算前只检查本次实际消费的模型。缺失的 GPU 模型否则会表现为设备失败，误导调用者换设备。
 */
export function require_models(keys: readonly ModelKey[]): void {
  const { modelsDirectory } = media_configuration();
  const absent = keys
    .map((key) => MEDIA_MODELS[key])
    .filter((model) => !model_ready(modelsDirectory, model))
    .map((model) => model.file);
  if (absent.length)
    throw new Error(
      `Media models are missing (${absent.join(", ")}); call prepare_models() first.`,
    );
}
