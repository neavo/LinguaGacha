import { inference_configuration } from "../inference/runtime";
import { MEDIA_MODELS } from "./models";
import { prepare_model_files, model_exists } from "../inference/models";

type ModelKey = keyof typeof MEDIA_MODELS;

/** 按目标文件是否存在列出模型缺口。 */
export function missing_models(): string[] {
  const { modelsDirectory } = inference_configuration();
  return Object.values(MEDIA_MODELS)
    .filter((model) => !model_exists(modelsDirectory, model))
    .map((model) => model.file);
}

/**
 * 复用已有模型，下载并校验缺失模型。失败保留已完成资源供续传。
 * 准备锁同时保护各模型共用的 aria2 服务器速度记录。
 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(MEDIA_MODELS));
}

/**
 * 计算前只检查本次实际消费的模型。缺失的 GPU 模型否则会表现为设备失败，误导调用者换设备。
 */
export function require_models(keys: readonly ModelKey[]): void {
  const { modelsDirectory } = inference_configuration();
  const absent = keys
    .map((key) => MEDIA_MODELS[key])
    .filter((model) => !model_exists(modelsDirectory, model))
    .map((model) => model.file);
  if (absent.length)
    throw new Error(
      `Media models are missing (${absent.join(", ")}); call prepare_models() first.`,
    );
}
