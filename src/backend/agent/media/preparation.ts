import { inference_configuration } from "../inference/runtime";
import { MEDIA_MODELS } from "./models";
import { prepare_model_files, model_ready } from "../inference/models";

type ModelKey = keyof typeof MEDIA_MODELS;

/** 按文件大小列出缺失模型，不校验内容。`prepare_models` 负责完整校验。 */
export async function missing_models(): Promise<string[]> {
  const { modelsDirectory } = inference_configuration();
  return Object.values(MEDIA_MODELS)
    .filter((model) => !model_ready(modelsDirectory, model))
    .map((model) => model.file);
}

/**
 * 逐个校验、复用或下载全部模型，返回剩余缺口。失败保留已完成资源供续传。
 * 准备锁同时保护各模型共用的 aria2 服务器速度记录。
 */
export async function prepare_models(): Promise<string[]> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(MEDIA_MODELS));
  return await missing_models();
}

/**
 * 计算前只检查本次实际消费的模型。缺失的 GPU 模型否则会表现为设备失败，误导调用者换设备。
 */
export function require_models(keys: readonly ModelKey[]): void {
  const { modelsDirectory } = inference_configuration();
  const absent = keys
    .map((key) => MEDIA_MODELS[key])
    .filter((model) => !model_ready(modelsDirectory, model))
    .map((model) => model.file);
  if (absent.length)
    throw new Error(
      `Media models are missing (${absent.join(", ")}); call prepare_models() first.`,
    );
}
