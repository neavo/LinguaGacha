import { BrowserWindow } from "electron";
import type { AgentImageHost, AgentImagePolicy } from "../shared/agent-image";

const IMAGE_HOST_TIMEOUT_MS = 30_000;

/** 图片解码属于 Electron 宿主，窗口随单次请求回收，取消沿现有宿主通道传播。 */
export const prepare_agent_image: AgentImageHost = async (operation, signal) => {
  signal.throwIfAborted();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const close = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  const timeout = setTimeout(close, IMAGE_HOST_TIMEOUT_MS);
  signal.addEventListener("abort", close, { once: true });
  try {
    await window.loadURL(
      'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob: data:">',
    );
    const request = {
      data: Buffer.from(operation.bytes).toString("base64"),
      mimeType: operation.mimeType,
      policy: operation.policy,
    };
    const result = (await window.webContents.executeJavaScript(
      `(${encode_image.toString()})(${JSON.stringify(request)})`,
    )) as {
      data: string;
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
    };
    signal.throwIfAborted();
    return {
      bytes: new Uint8Array(Buffer.from(result.data, "base64")),
      width: result.width,
      height: result.height,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", close);
    close();
  }
};

/** 此函数独立序列化到隔离 renderer，所有策略来自后端请求，不能捕获模块变量。 */
async function encode_image(request: { data: string; mimeType: string; policy: AgentImagePolicy }) {
  const { policy } = request;
  const bytes = Uint8Array.from(atob(request.data), (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: request.mimeType }));
  try {
    const original = { originalWidth: bitmap.width, originalHeight: bitmap.height };
    if (bitmap.width * bitmap.height > policy.maxPixels)
      throw new Error("Image exceeds pixel limit.");
    const scale = Math.min(1, policy.maxEdge / bitmap.width, policy.maxEdge / bitmap.height);
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    if (request.mimeType === "image/webp" && scale === 1 && bytes.byteLength <= policy.maxBytes)
      return { data: request.data, width, height, ...original };
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Image canvas unavailable.");
    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      const url = canvas.toDataURL("image/webp", policy.quality);
      if (!url.startsWith("data:image/webp;base64,")) throw new Error("WebP encoder unavailable.");
      const data = url.slice(url.indexOf(",") + 1);
      if (atob(data).length <= policy.maxBytes) return { data, width, height, ...original };
      if (width === 1 && height === 1) throw new Error("Image exceeds output limit.");
      const shrink = 0.75; // 固定降采样步长，使尺寸持续收敛。
      width = Math.max(1, Math.floor(width * shrink));
      height = Math.max(1, Math.floor(height * shrink));
    }
  } finally {
    bitmap.close();
  }
}
