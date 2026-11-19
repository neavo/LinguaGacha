import {
  IMAGE_TEXT_RULES as RULES,
  image_text_color,
  image_text_stroke_width,
  type ImageTextPage,
  type ImageTextPaint,
} from "../shared/image-text";
import { plan_image_text } from "./image-text-plan";

const SIDEWAYS_MARKS = /([?!？！⁇⁈⁉‼]+)/u;

/** main 按区域尺寸设置视口并捕获透明截图。 */
export type ImageTextCapture = { width: number; height: number };

/** helper 输出 little-endian Float32 距离场，浏览器按原字节读取。 */
function decode_distance(value: string): Float32Array {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

/** 将原生截图解码到一比一像素画布，供最终距离门禁读取 alpha。 */
async function decode_screenshot(png: string, width: number, height: number) {
  const image = new Image();
  image.src = "data:image/png;base64," + png;
  await image.decode();
  if (image.width !== width || image.height !== height)
    throw new Error("Image text requires DPR 1");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return context;
}

/** Chromium 绘制排版方案，原图坐标的距离场验收最终像素。 */
export async function* render_page(
  page: ImageTextPage,
  fontCss: string,
): AsyncGenerator<ImageTextCapture, ImageTextPaint[], string | undefined> {
  const style = document.createElement("style");
  style.textContent = fontCss + "html,body{margin:0;background:transparent}body{overflow:hidden}";
  document.head.replaceChildren(style);
  // 同一页共用一个字体文件，Chromium 负责缺字回退。
  if (!(await document.fonts.load("16px ImageText")).length)
    throw new Error("Image text font unavailable");
  const output: ImageTextPaint[] = [];
  for (const region of page) {
    const distance = decode_distance(region.distance);
    const planned = plan_image_text(region, distance);
    if (!planned) {
      output.push({ regionId: region.regionId, png: null });
      continue;
    }
    const [width, height] = region.size;
    const root = document.createElement("div");
    const ink = image_text_color(region.backgroundColor);
    const stroke = ink === "black" ? "white" : "black";
    const strokeWidth = image_text_stroke_width(planned.fontSize);
    root.style.cssText = `
      position:relative;width:${width}px;height:${height}px;
      font:${planned.fontSize}px/1 ImageText;font-synthesis:none;
      white-space:pre;writing-mode:${region.direction};color:${ink};
      -webkit-text-stroke:${strokeWidth}px ${stroke};paint-order:stroke fill;
    `;
    for (const line of planned.lines) {
      const element = document.createElement("span");
      element.style.position = "absolute";
      if (region.direction === "vertical-rl") {
        // 横排字形旋转后沿竖排方向使用同一个 advance，和 Pretext 的测量一致。
        for (const [index, text] of line.text.split(SIDEWAYS_MARKS).entries()) {
          if (index % 2 === 0) {
            element.append(text);
          } else {
            const mark = document.createElement("span");
            mark.style.textOrientation = "sideways";
            mark.textContent = text;
            element.append(mark);
          }
        }
        element.style.left = width - line.slot.blockStart - planned.fontSize + "px";
        element.style.top = line.inlineStart + "px";
      } else {
        element.textContent = line.text;
        element.style.left = line.inlineStart + "px";
        element.style.top = line.slot.blockStart + "px";
      }
      root.append(element);
    }
    document.body.replaceChildren(root);
    const png = yield { width, height };
    if (!png) throw new Error("Missing native text screenshot");
    const context = await decode_screenshot(png, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    let fits = false; // 完全透明的截图也不可用于覆盖原文。
    for (let index = 0; index < width * height; index++) {
      if (!pixels.data[index * 4 + 3]) continue;
      fits = distance[index]! >= RULES.squareDistanceCorrection;
      if (!fits) break;
    }
    output.push({
      regionId: region.regionId,
      png: fits ? png : null,
    });
  }
  return output;
}
