import { model_ready, prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 来源提交与摘要共同固定模型身份，准备阶段不追踪远端最新版本。
export const IMAGE_MODELS = Object.freeze({
  bubble: {
    file: "segmentationbubble_onnx_cpu_webgpu_fp32/model.onnx",
    size: 11441936,
    sha256: "197d63145a857afa258b085aabc9476a320772a2a70ca8aedb549710e506e452",
    urls: [
      "https://huggingface.co/neavo/SegmentationBubble-ONNX-CPU-WebGPU-FP32/resolve/67a18e1f60f700b2574f3806351d9bbe2f762c82/model.onnx",
      "https://modelscope.cn/models/neavo7/SegmentationBubble-ONNX-CPU-WebGPU-FP32/resolve/master/model.onnx",
    ],
  },
} satisfies Record<string, InferenceModel>);

export type ImageModelKind = keyof typeof IMAGE_MODELS; // 图片领域气泡分割模型标识。

/** 检查当前缺失的图片推理权重标识。 */
export function missing_models(): ImageModelKind[] {
  const { modelsDirectory } = inference_configuration();
  return (Object.entries(IMAGE_MODELS) as [ImageModelKind, InferenceModel][])
    .filter(([, model]) => !model_ready(modelsDirectory, model))
    .map(([kind]) => kind);
}

/** 两个领域共用下载统计文件，准备锁覆盖整批模型校验。 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(IMAGE_MODELS));
}
