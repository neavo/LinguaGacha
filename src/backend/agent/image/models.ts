import { TEXT_DETECTION_MODELS } from "../inference/text-detection";
import { model_exists, prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 目标文件存在时沿用；缺失时从远端主分支取得当前版本。
export const IMAGE_MODELS = Object.freeze({
  text: TEXT_DETECTION_MODELS.manga,
  recognition: {
    file: "pp_ocrv6_manga/rec/manga_rec.onnx",
    urls: [
      "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master/rec/manga_rec.onnx",
      "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/main/rec/manga_rec.onnx",
    ],
  },
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

export const IMAGE_DICTIONARY = Object.freeze({
  file: "pp_ocrv6_manga/ppocrv6_dict.txt",
  urls: [
    "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master/ppocrv6_dict.txt",
    "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/main/ppocrv6_dict.txt",
  ],
} satisfies InferenceModel);

export type ImageModelKind = keyof typeof IMAGE_MODELS; // 气泡分割、文字检测、识别与背景修复任务。
const IMAGE_RESOURCES = Object.freeze({ ...IMAGE_MODELS, dictionary: IMAGE_DICTIONARY }); // 准备范围还包含识别字典。
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
