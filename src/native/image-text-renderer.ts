import {
  IMAGE_TEXT_RULES as RULES,
  image_text_color,
  type ImageTextPage,
  type ImageTextPaint,
} from "../shared/image-text";

/** renderer 依次请求视口和透明截图，main 负责实际捕获。 */
export type ImageTextRenderStep =
  | { kind: "capture"; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "resize"; width: number; height: number };

/** 将原生截图解码到一比一像素画布，确认捕获确实包含文字。 */
async function decode(png: string, width: number, height: number) {
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

/** Chromium 负责换行、书写方向与字形回退。应用只拟合矩形。 */
export async function* render_page(
  page: ImageTextPage,
  fontCss: string,
): AsyncGenerator<ImageTextRenderStep, ImageTextPaint[], string | undefined> {
  const style = document.createElement("style");
  style.textContent =
    fontCss +
    `
    html, body { margin: 0; background: transparent; }
    * { box-sizing: border-box; }
    .box { display: flex; flex-direction: column; justify-content: center; }
    .text {
      flex: none; inline-size: 100%;
      white-space: pre-wrap; overflow-wrap: anywhere; text-align: center;
      font-family: ImageText; font-synthesis: none;
      paint-order: stroke fill;
    }
  `;
  document.head.replaceChildren(style);
  if (!(await document.fonts.load("16px ImageText")).length)
    throw new Error("Image text font unavailable");

  const output: ImageTextPaint[] = [];
  for (const region of page.regions) {
    const [, , width, height] = region.box;
    const root = document.createElement("div");
    root.className = "box";
    root.style.width = width + "px";
    root.style.height = height + "px";
    root.style.writingMode = region.direction;
    root.style.padding = Math.min(width, height) > 2 ? "1px" : "0";
    const element = document.createElement("div");
    element.className = "text";
    element.textContent = region.text;
    const color = image_text_color(region.backgroundColor);
    element.style.color = color;
    element.style.lineHeight = String(RULES.lineHeight);
    element.style.setProperty(
      "-webkit-text-stroke",
      "0.5px " + (color === "black" ? "white" : "black"),
    );
    root.append(element);
    document.body.replaceChildren(root);
    yield { kind: "resize", width, height };

    let low = 1;
    let high = Math.max(low, Math.floor(Math.min(width, height) / 3));
    let size = 0;
    const bounds = root.getBoundingClientRect();
    const content = document.createRange();
    content.selectNodeContents(element);
    while (low <= high) {
      const trial = Math.floor((low + high) / 2);
      element.style.fontSize = trial + "px";
      const fits = Array.from(content.getClientRects()).every(
        (rect) =>
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom,
      );
      if (fits) {
        size = trial;
        low = trial + 1;
      } else high = trial - 1;
    }
    if (!size) {
      output.push({ regionId: region.regionId, png: null });
      continue;
    }

    element.style.fontSize = size + "px";
    const png = yield { kind: "capture", rect: { x: 0, y: 0, width, height } };
    if (!png) throw new Error("Missing native text screenshot");
    const context = await decode(png, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const visible = data.some((value, index) => index % 4 === 3 && value !== 0);
    output.push({ regionId: region.regionId, png: visible ? png : null });
  }
  return output;
}
