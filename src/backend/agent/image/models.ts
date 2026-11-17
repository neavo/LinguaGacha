import { TEXT_DETECTION_MODELS } from "../inference/text-detection";
import { model_ready, prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 来源提交与摘要共同固定模型身份，准备阶段不追踪远端最新版本。
export const IMAGE_MODELS = Object.freeze({
  text: TEXT_DETECTION_MODELS.manga,
  inpaint: {
    file: "lama/lama-large-fp32-unified-webgpu.onnx",
    size: 204452450,
    sha256: "77f755491ce57992a873bc5d007ef9f58b0ff84b38206784f72d3db219bed4ea",
    urls: [
      "https://modelscope.cn/models/neavo7/LaMa-Large-ONNX-WebGPU-FP32/resolve/master/lama-large-fp32-unified-webgpu.onnx",
      "https://huggingface.co/neavo/LaMa-Large-ONNX-WebGPU-FP32/resolve/ecd803ac50c5080263d70edece0e722e752eefb9/lama-large-fp32-unified-webgpu.onnx",
    ],
  },
  bubble: {
    file: "segmentationbubble_onnx_cpu_webgpu_fp32/model.onnx",
    size: 11441936,
    sha256: "197d63145a857afa258b085aabc9476a320772a2a70ca8aedb549710e506e452",
    urls: [
      "https://modelscope.cn/models/neavo7/SegmentationBubble-ONNX-CPU-WebGPU-FP32/resolve/master/model.onnx",
      "https://huggingface.co/neavo/SegmentationBubble-ONNX-CPU-WebGPU-FP32/resolve/67a18e1f60f700b2574f3806351d9bbe2f762c82/model.onnx",
    ],
  },
} satisfies Record<string, InferenceModel>);

export type ImageModelKind = keyof typeof IMAGE_MODELS; // 气泡分割、文字检测与背景修复任务。

/** 检查当前缺失的图片推理权重标识。 */
export function missing_models(): ImageModelKind[] {
  const { modelsDirectory } = inference_configuration();
  return (Object.entries(IMAGE_MODELS) as [ImageModelKind, InferenceModel][])
    .filter(([, model]) => !model_ready(modelsDirectory, model))
    .map(([kind]) => kind);
}

/** 共用下载统计文件，准备锁覆盖整批模型校验。 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(IMAGE_MODELS));
}
