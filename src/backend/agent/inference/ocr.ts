import type { InferenceModel } from "./models";
import { float, infer, type Ort, type OrtSession } from "./ort";

const MANGA_URLS = [
  "https://modelscope.cn/models/neavo7/PP-OCRv6-Manga/resolve/master",
  "https://huggingface.co/neavo/PP-OCRv6-Manga/resolve/main",
];
const mirrors = (file: string): string[] => MANGA_URLS.map((base) => `${base}/${file}`);

/** 图片与媒体共用的 PP-OCRv6-Manga 资源。 */
export const MANGA_OCR_RESOURCES = Object.freeze({
  detection: {
    file: "pp_ocrv6_manga/det/manga_det.onnx",
    urls: mirrors("det/manga_det.onnx"),
  },
  recognition: {
    file: "pp_ocrv6_manga/rec/manga_rec.onnx",
    urls: mirrors("rec/manga_rec.onnx"),
  },
  dictionary: {
    file: "pp_ocrv6_manga/ppocrv6_dict.txt",
    urls: mirrors("ppocrv6_dict.txt"),
  },
} satisfies Record<"detection" | "recognition" | "dictionary", InferenceModel>);

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
    for (const value of data) {
      if (!Number.isFinite(value)) throw new Error("Model output is not finite.");
      if (value < 0 || value > 1) throw new Error("Detection output is not a probability map.");
    }
    return { shape: output.dims.slice(-2), data };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

/** 按 CTC 规则返回去重字符编号；文字映射由需要字典的图片领域完成。 */
export async function recognize_tokens(
  ort: Ort,
  session: OrtSession,
  input: Float32Array,
  shape: number[],
): Promise<{ tokens: number[]; classes: number }> {
  if (shape.length !== 4 || shape[0] !== 1 || shape[1] !== 3 || shape[2] !== 48)
    throw new Error(`Unexpected recognition input: ${JSON.stringify(shape)}`);
  const outputs = await infer(session, {
    [session.inputNames[0]!]: new ort.Tensor("float32", input, shape),
  });
  try {
    const output = outputs[session.outputNames[0]!]!;
    const data = float(output.data);
    const [batch, length, classes] = output.dims;
    if (
      output.dims.length !== 3 ||
      batch !== 1 ||
      !length ||
      !classes ||
      classes < 2 ||
      data.length !== length * classes
    )
      throw new Error(`Unexpected recognition output: ${output.dims}`);
    const tokens: number[] = [];
    let previous = -1;
    for (let step = 0; step < length; step++) {
      const base = step * classes;
      let best = 0;
      if (!Number.isFinite(data[base])) throw new Error("Model output is not finite.");
      for (let index = 1; index < classes; index++) {
        const value = data[base + index]!;
        if (!Number.isFinite(value)) throw new Error("Model output is not finite.");
        if (value > data[base + best]!) best = index;
      }
      // blank 也更新 previous，使两侧相同字符分别保留。
      if (best !== 0 && best !== previous) tokens.push(best);
      previous = best;
    }
    return { tokens, classes };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}
