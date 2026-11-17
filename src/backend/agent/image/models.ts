import { MANGA_OCR_RESOURCES } from "../inference/ocr";
import { model_exists, prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 目标文件存在时沿用；缺失时从远端主分支取得当前版本。
export const IMAGE_MODELS = Object.freeze({
  detection: MANGA_OCR_RESOURCES.detection,
  recognition: MANGA_OCR_RESOURCES.recognition,
  inpaint: {
    file: "lama_large_onnx_fp32/model.onnx",
    urls: [
      "https://modelscope.cn/models/neavo7/LaMa-Large-ONNX-FP32/resolve/master/model.onnx",
      "https://huggingface.co/neavo/LaMa-Large-ONNX-FP32/resolve/main/model.onnx",
    ],
  },
  bubble: {
    file: "segmentationbubble_onnx_fp32/model.onnx",
    urls: [
      "https://modelscope.cn/models/neavo7/SegmentationBubble-ONNX-FP32/resolve/master/model.onnx",
      "https://huggingface.co/neavo/SegmentationBubble-ONNX-FP32/resolve/main/model.onnx",
    ],
  },
} satisfies Record<string, InferenceModel>);

export type ImageModelKind = keyof typeof IMAGE_MODELS; // 气泡分割、文字检测、识别与背景修复任务。
export const IMAGE_RESOURCES = Object.freeze({
  ...IMAGE_MODELS,
  dictionary: MANGA_OCR_RESOURCES.dictionary,
});
export type ImageResourceKind = keyof typeof IMAGE_RESOURCES;

/** 检查当前缺失的图片推理权重标识。 */
export function missing_models(): ImageResourceKind[] {
  const { modelsDirectory } = inference_configuration();
  return (Object.keys(IMAGE_RESOURCES) as ImageResourceKind[]).filter(
    (kind) => !model_exists(modelsDirectory, IMAGE_RESOURCES[kind]),
  );
}

/** 用同一准备锁下载当前缺失的模型与字典。 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(IMAGE_RESOURCES));
}
