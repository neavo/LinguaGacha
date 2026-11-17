import { TEXT_DETECTION_MODELS } from "../inference/text-detection";
import { model_ready, prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 来源提交与摘要共同固定模型身份，准备阶段不追踪远端最新版本。
export const IMAGE_MODELS = Object.freeze({
  text: TEXT_DETECTION_MODELS.manga,
  recognition: {
    file: "pp_ocrv6_manga/rec/manga_rec.onnx",
    size: 21_334_702,
    sha256: "5288bd221a9a047c6b7d1ff56bb98de8c875fb613df98ebe8754946448bda540",
    urls: [
      "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master/rec/manga_rec.onnx",
      "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/851eb0e498007ca66420b410e102f5107416b8f6/rec/manga_rec.onnx",
    ],
  },
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

export const IMAGE_DICTIONARY = Object.freeze({
  file: "pp_ocrv6_manga/ppocrv6_dict.txt",
  size: 76_327,
  sha256: "4f0f8971ecb95e3a4d278985d6eaac154413e81fda0b4c941db17389580e9e9b",
  urls: [
    "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master/ppocrv6_dict.txt",
    "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/851eb0e498007ca66420b410e102f5107416b8f6/ppocrv6_dict.txt",
  ],
} satisfies InferenceModel);

export type ImageModelKind = keyof typeof IMAGE_MODELS; // 气泡分割、文字检测、识别与背景修复任务。
export type ImageResourceKind = ImageModelKind | "dictionary";

/** 检查当前缺失的图片推理权重标识。 */
export function missing_models(): ImageResourceKind[] {
  const { modelsDirectory } = inference_configuration();
  return (
    [...Object.entries(IMAGE_MODELS), ["dictionary", IMAGE_DICTIONARY]] as [
      ImageResourceKind,
      InferenceModel,
    ][]
  )
    .filter(([, model]) => !model_ready(modelsDirectory, model))
    .map(([kind]) => kind);
}

/** 共用下载统计文件，准备锁覆盖整批模型校验。 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, [
    ...Object.values(IMAGE_MODELS),
    IMAGE_DICTIONARY,
  ]);
}
