import type { InferenceModel } from "../inference/models";
const W8A32 = "SenseVoiceSmall-ONNX-WebGPU-W8A32";
const W8A32_URLS = [
  `https://huggingface.co/neavo/${W8A32}/resolve/1006fa8a2b61075b3797ad211783caf418554b22`,
  `https://modelscope.cn/models/neavo7/${W8A32}/resolve/b41eb665cb5c93cfa72c6fbdda74a6c6bff13d36`,
];
const PPOCR_URLS = [
  "https://huggingface.co/neavo/PP-OCRv6-ONNX/resolve/f8d7df21b3cde6d331224b5728d7dffb8058b8d1",
  "https://modelscope.cn/models/neavo7/PP-OCRv6-ONNX/resolve/45e0cc57a4ea02feed488b5a0508257142a6009c",
];
const FSMN_URLS = [
  "https://huggingface.co/neavo/FSMN-VAD-ONNX/resolve/2baa9f06b5d56e871d3d30a4d9b9836bc5f141dd",
  "https://modelscope.cn/models/neavo7/FSMN-VAD-ONNX/resolve/3de348810c794315a5f36939717887df1b858af5",
];
const mirrors = (bases: readonly string[], file: string): string[] =>
  bases.map((base) => `${base}/${file}`);

/**
 * 模型清单。版本变化通过修改清单发布，启动时不追踪远端最新权重。
 * SenseVoiceSmall 来自阿里巴巴 FunASR，许可要求注明来源与作者并保留模型名。
 * FSMN-Monophone VAD 来自 Alibaba / FunASR，模型许可为 Apache-2.0。
 */
export const MEDIA_MODELS = Object.freeze({
  vad: {
    file: "fsmn_vad/model_quant.onnx",
    size: 506744,
    sha256: "5289eb2aa3c9af2d7a4284bcfa7c3ceb81d360814ed4203239b6c5d0569da8a1",
    urls: mirrors(FSMN_URLS, "model_quant.onnx"),
  },
  vad_mvn: {
    file: "fsmn_vad/am.mvn",
    size: 8040,
    sha256: "6820fef9687708c4fc3fab2530179c8fcea6262daa25514380056cd8f6eb1754",
    urls: mirrors(FSMN_URLS, "am.mvn"),
  },
  // CPU 使用官方动态 INT8 导出，镜像与官方源内容一致。
  asr_cpu: {
    file: "sensevoice/model_quant.onnx",
    size: 241216270,
    sha256: "21dc965f689a78d1604717bf561e40d5a236087c85a95584567835750549e822",
    urls: [
      "https://huggingface.co/neavo/SenseVoiceSmall-ONNX-CPU-INT8/resolve/0966ccc0e484cdaf4dc84ebecf049f0239a05901/model_quant.onnx",
      "https://modelscope.cn/models/neavo7/SenseVoiceSmall-ONNX-CPU-INT8/resolve/ef9414333f29e1c753b7dcfdf19a2c226e825dd4/model_quant.onnx",
    ],
  },
  // GPU 使用官方权重导出的 W8A32，与 CPU 权重共用词表与前处理。
  asr_gpu: {
    file: "sensevoice/model.w8a32.onnx",
    size: 267521956,
    sha256: "e6e4badd5ef43c545e09a940ac519928f39aea9a09935d00fa3495ae324b0229",
    urls: mirrors(W8A32_URLS, "model.w8a32.onnx"),
  },
  tokens: {
    file: "sensevoice/tokens.txt",
    size: 315894,
    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    urls: mirrors(W8A32_URLS, "tokens.txt"),
  },
  asr_mvn: {
    file: "sensevoice/am.mvn",
    size: 11203,
    sha256: "29b3c740a2c0cfc6b308126d31d7f265fa2be74f3bb095cd2f143ea970896ae5",
    urls: mirrors(W8A32_URLS, "am.mvn"), // 官方 iic/SenseVoiceSmall 同一文件的自有镜像。
  },
  det_cpu: {
    file: "ppocr/v6/PP-OCRv6_det_small.onnx",
    size: 9929594,
    sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    urls: mirrors(PPOCR_URLS, "det/PP-OCRv6_det_small.onnx"),
  },
  det_gpu: {
    file: "ppocr/v6/PP-OCRv6_det_medium.onnx",
    size: 62119454,
    sha256: "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    urls: mirrors(PPOCR_URLS, "det/PP-OCRv6_det_medium.onnx"),
  },
  rec_cpu: {
    file: "ppocr/v6/PP-OCRv6_rec_small.onnx",
    size: 21234383,
    sha256: "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    urls: mirrors(PPOCR_URLS, "rec/PP-OCRv6_rec_small.onnx"),
  },
  rec_gpu: {
    file: "ppocr/v6/PP-OCRv6_rec_medium.onnx",
    size: 76629984,
    sha256: "eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b",
    urls: mirrors(PPOCR_URLS, "rec/PP-OCRv6_rec_medium.onnx"),
  },
} satisfies Record<string, InferenceModel>);
