import type { InferenceModel } from "./models";
import { check_finite, float, infer, type Ort, type OrtSession } from "./ort";

const PPOCR_URLS = [
  "https://modelscope.cn/models/neavo7/PP-OCRv6-ONNX/resolve/master",
  "https://huggingface.co/neavo/PP-OCRv6-ONNX/resolve/main",
];
const mirrors = (file: string): string[] => PPOCR_URLS.map((base) => `${base}/${file}`);

/** 跨领域共用的 PP-OCRv6 文字检测模型清单。 */
export const TEXT_DETECTION_MODELS = Object.freeze({
  small: {
    file: "ppocr/v6/PP-OCRv6_det_small.onnx",
    urls: mirrors("det/PP-OCRv6_det_small.onnx"),
  },
  medium: {
    file: "ppocr/v6/PP-OCRv6_det_medium.onnx",
    urls: mirrors("det/PP-OCRv6_det_medium.onnx"),
  },
  manga: {
    file: "pp_ocrv6_manga/det/manga_det.onnx",
    urls: [
      "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master/det/manga_det.onnx",
      "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/main/det/manga_det.onnx",
    ],
  },
} satisfies Record<string, InferenceModel>);

/** 执行文字检测推理并拷贝输出概率图 [H, W]，统一释放张量。 */
export async function detect_text(
  ort: Ort,
  session: OrtSession,
  input: Float32Array,
  shape: number[],
): Promise<{ shape: number[]; data: Float32Array<ArrayBuffer> }> {
  if (shape.length !== 4 || shape[0] !== 1 || shape[1] !== 3)
    throw new Error(`Unexpected detection input: ${JSON.stringify(shape)}`);
  const outputs = await infer(session, {
    [session.inputNames[0]!]: new ort.Tensor("float32", input, shape),
  });
  try {
    const output = outputs[session.outputNames[0]!]!;
    const data = new Float32Array(float(output.data));
    if (output.dims.join() !== [1, 1, ...shape.slice(-2)].join())
      throw new Error(`Unexpected detection output: ${output.dims}`);
    check_finite(data);
    if (data.some((value) => value < 0 || value > 1))
      throw new Error("Detection output is not a probability map.");
    return { shape: output.dims.slice(-2), data };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}
