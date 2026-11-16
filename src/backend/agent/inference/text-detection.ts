import type { InferenceModel } from "./models";
import { check_finite, float, infer, type Ort, type OrtSession } from "./ort";

const PPOCR_URLS = [
  "https://modelscope.cn/models/neavo7/PP-OCRv6-ONNX/resolve/45e0cc57a4ea02feed488b5a0508257142a6009c",
  "https://huggingface.co/neavo/PP-OCRv6-ONNX/resolve/f8d7df21b3cde6d331224b5728d7dffb8058b8d1",
];
const mirrors = (file: string): string[] => PPOCR_URLS.map((base) => `${base}/${file}`);

/** 跨领域共用的 PP-OCRv6 文字检测模型清单。 */
export const TEXT_DETECTION_MODELS = Object.freeze({
  small: {
    file: "ppocr/v6/PP-OCRv6_det_small.onnx",
    size: 9929594,
    sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    urls: mirrors("det/PP-OCRv6_det_small.onnx"),
  },
  medium: {
    file: "ppocr/v6/PP-OCRv6_det_medium.onnx",
    size: 62119454,
    sha256: "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    urls: mirrors("det/PP-OCRv6_det_medium.onnx"),
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
