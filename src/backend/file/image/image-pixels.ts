import { image_metadata } from "./image-metadata";

function apply_exif_orientation(
  rgb: Uint8Array,
  rawW: number,
  rawH: number,
  orientation: number,
): { width: number; height: number; rgb: Uint8Array } {
  if (orientation === 1) return { width: rawW, height: rawH, rgb };
  const width = orientation >= 5 ? rawH : rawW;
  const height = orientation >= 5 ? rawW : rawH;
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < rawH; y++) {
    for (let x = 0; x < rawW; x++) {
      let nx = x;
      let ny = y;
      if (orientation === 2) nx = rawW - 1 - x;
      else if (orientation === 3) {
        nx = rawW - 1 - x;
        ny = rawH - 1 - y;
      } else if (orientation === 4) ny = rawH - 1 - y;
      else if (orientation === 5) {
        nx = y;
        ny = x;
      } else if (orientation === 6) {
        nx = rawH - 1 - y;
        ny = x;
      } else if (orientation === 7) {
        nx = rawH - 1 - y;
        ny = rawW - 1 - x;
      } else if (orientation === 8) {
        nx = y;
        ny = rawW - 1 - x;
      }
      const srcOff = (y * rawW + x) * 3;
      const dstOff = (ny * width + nx) * 3;
      out[dstOff] = rgb[srcOff]!;
      out[dstOff + 1] = rgb[srcOff + 1]!;
      out[dstOff + 2] = rgb[srcOff + 2]!;
    }
  }
  return { width, height, rgb: out };
}

/** 统一规范化像素解码：复用 MuPDF 解码静态非透明 PNG/JPEG 并按 EXIF 方向旋正为 RGB。 */
export async function decode_normalized_image_rgb(content: Uint8Array): Promise<{
  extension: string;
  width: number;
  height: number;
  orientation: number;
  rgb: Uint8Array;
}> {
  const meta = image_metadata(content);
  const rawW = meta.orientation >= 5 ? meta.height : meta.width;
  const rawH = meta.orientation >= 5 ? meta.width : meta.height;

  // 延迟加载 MuPDF，避免仅使用结构校验的工作区数据模块在初始化阶段引入 WASM 引擎。
  const mupdf = await import("mupdf");
  const img = new mupdf.Image(content);
  let pix: ReturnType<typeof img.toPixmap> | undefined;
  let rgbPix: ReturnType<typeof img.toPixmap> | undefined;
  try {
    pix = img.toPixmap();
    if (pix.getWidth() !== rawW || pix.getHeight() !== rawH) {
      throw new Error("Decoded image dimensions mismatch metadata");
    }
    const hasAlpha = Boolean(pix.getAlpha());
    rgbPix =
      pix.getColorSpace()?.getName() === "DeviceRGB"
        ? pix
        : pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, hasAlpha);

    const rawPixels = rgbPix.getPixels();
    const components = rgbPix.getNumberOfComponents();
    let rawRgb: Uint8Array;
    if (hasAlpha) {
      if (components !== 4) throw new Error("Unexpected RGBA pixel stride");
      rawRgb = new Uint8Array(rawW * rawH * 3);
      for (let i = 0, src = 0, dst = 0; i < rawW * rawH; i++, src += 4, dst += 3) {
        if (rawPixels[src + 3] !== 255) throw new Error("Transparent image is unsupported");
        rawRgb[dst] = rawPixels[src]!;
        rawRgb[dst + 1] = rawPixels[src + 1]!;
        rawRgb[dst + 2] = rawPixels[src + 2]!;
      }
    } else {
      if (components !== 3) throw new Error("Unexpected RGB pixel stride");
      rawRgb = new Uint8Array(rawPixels);
    }

    const oriented = apply_exif_orientation(rawRgb, rawW, rawH, meta.orientation);
    return {
      extension: meta.extension,
      width: oriented.width,
      height: oriented.height,
      orientation: meta.orientation,
      rgb: oriented.rgb,
    };
  } finally {
    if (rgbPix && rgbPix !== pix) rgbPix.destroy();
    pix?.destroy();
    img.destroy();
  }
}

/** 统一无损规范化编码：将 PNG/JPEG 原稿按与读取校验完全一致的规则转换为 EXIF 旋正后 RGB PNG。 */
export async function normalize_image_to_png(content: Uint8Array): Promise<{
  width: number;
  height: number;
  orientation: number;
  png: Uint8Array;
}> {
  const decoded = await decode_normalized_image_rgb(content);
  const mupdf = await import("mupdf");
  const pix = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, decoded.width, decoded.height],
    false,
  );
  try {
    pix.getPixels().set(decoded.rgb);
    return {
      width: decoded.width,
      height: decoded.height,
      orientation: decoded.orientation,
      png: new Uint8Array(pix.asPNG()),
    };
  } finally {
    pix.destroy();
  }
}
