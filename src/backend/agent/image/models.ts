import { prepare_model_files, type InferenceModel } from "../inference/models";
import { inference_configuration } from "../inference/runtime";

// 来源提交与摘要共同固定模型身份，准备阶段不追踪远端最新版本。
export const IMAGE_MODELS = Object.freeze({
  shadow: {
    file: "manga109_yolo26/model.onnx",
    size: 41587926,
    sha256: "2a30ea55e1da929857a35d4951a74e42b433f986f3c60723c7c1c76db7677c1a",
    urls: [
      "https://huggingface.co/neavo/Manga109-YOLO26-ONNX-CPU-FP32/resolve/c114747877933200f6195ac6f3c42f00f4c7acd3/model.onnx",
    ],
  },
  inpaint: {
    file: "lama/lama-large-fp32-unified-webgpu.onnx",
    size: 204452450,
    sha256: "77f755491ce57992a873bc5d007ef9f58b0ff84b38206784f72d3db219bed4ea",
    urls: [
      "https://huggingface.co/neavo/LaMa-Large-ONNX-WebGPU-FP32/resolve/ecd803ac50c5080263d70edece0e722e752eefb9/lama-large-fp32-unified-webgpu.onnx",
    ],
  },
} satisfies Record<string, InferenceModel>);

/** 两个领域共用下载统计文件，准备锁覆盖整批模型校验。 */
export async function prepare_models(): Promise<void> {
  const { modelsDirectory, cacheDirectory } = inference_configuration();
  await prepare_model_files(modelsDirectory, cacheDirectory, Object.values(IMAGE_MODELS));
}
