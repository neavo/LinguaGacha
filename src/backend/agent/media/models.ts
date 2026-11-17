import type { InferenceModel } from "../inference/models";
import { MANGA_OCR_RESOURCES } from "../inference/ocr";
const W8A32 = "SenseVoiceSmall-ONNX-WebGPU-W8A32";
const W8A32_URLS = [
  `https://modelscope.cn/models/neavo7/${W8A32}/resolve/master`,
  `https://huggingface.co/neavo/${W8A32}/resolve/main`,
];
const FSMN_URLS = [
  "https://modelscope.cn/models/neavo7/FSMN-VAD-ONNX/resolve/master",
  "https://huggingface.co/neavo/FSMN-VAD-ONNX/resolve/main",
];
const mirrors = (bases: readonly string[], file: string): string[] =>
  bases.map((base) => `${base}/${file}`);

/**
 * 模型清单。已有文件保持不变，缺失时从远端主分支取得当前权重。
 * SenseVoiceSmall 来自阿里巴巴 FunASR，许可要求注明来源与作者并保留模型名。
 * FSMN-Monophone VAD 来自 Alibaba / FunASR，模型许可为 Apache-2.0。
 */
export const MEDIA_MODELS = Object.freeze({
  vad: {
    file: "fsmn_vad/model_quant.onnx",
    urls: mirrors(FSMN_URLS, "model_quant.onnx"),
  },
  vad_mvn: {
    file: "fsmn_vad/am.mvn",
    urls: mirrors(FSMN_URLS, "am.mvn"),
  },
  // CPU 使用官方动态 INT8 导出，镜像与官方源内容一致。
  asr_cpu: {
    file: "sensevoice/model_quant.onnx",
    urls: [
      "https://modelscope.cn/models/neavo7/SenseVoiceSmall-ONNX-CPU-INT8/resolve/master/model_quant.onnx",
      "https://huggingface.co/neavo/SenseVoiceSmall-ONNX-CPU-INT8/resolve/main/model_quant.onnx",
    ],
  },
  // GPU 使用官方权重导出的 W8A32，与 CPU 权重共用词表与前处理。
  asr_gpu: {
    file: "sensevoice/model.w8a32.onnx",
    urls: mirrors(W8A32_URLS, "model.w8a32.onnx"),
  },
  tokens: {
    file: "sensevoice/tokens.txt",
    urls: mirrors(W8A32_URLS, "tokens.txt"),
  },
  asr_mvn: {
    file: "sensevoice/am.mvn",
    urls: mirrors(W8A32_URLS, "am.mvn"), // 官方 iic/SenseVoiceSmall 同一文件的自有镜像。
  },
  detection: MANGA_OCR_RESOURCES.detection,
  recognition: MANGA_OCR_RESOURCES.recognition,
} satisfies Record<string, InferenceModel>);
