import {
  IMAGE_TEXT_RULES as RULES,
  image_text_color,
  image_text_margin,
  type ImageTextPage,
  type ImageTextPaint,
} from "../shared/image-text";
import { image_text_rectangles } from "./image-text-layout";

type Rect = { x: number; y: number; width: number; height: number };
type Step =
  | { kind: "capture"; rect: Rect }
  | { kind: "resize"; width: number; height: number }
  | { kind: "progress" | "font_check" };
type Line = { text: string; start: number; boxes: number[][] };
type Tile = { element: HTMLElement; rect: Rect; x: number; y: number };

/** 以字素的原生位置归组，隔离行时保留段落布局与双向语义。 */
function text_lines(
  content: HTMLElement,
  graphemes: readonly Intl.SegmentData[],
  vertical: boolean,
): Line[] {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number; end: number }[] = [];
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = offset + node.textContent!.length;
    nodes.push({ node, start: offset, end });
    offset = end;
  }
  const range = document.createRange();
  const lines: Line[] = [];
  let current = 0;
  for (const { segment, index } of graphemes) {
    while (index >= nodes[current]!.end) current++;
    const entry = nodes[current]!;
    if (index + segment.length > entry.end) throw new Error("Line isolation split a grapheme");
    range.setStart(entry.node, index - entry.start);
    range.setEnd(entry.node, index + segment.length - entry.start);
    const r = range.getBoundingClientRect();
    const box = [r.x, r.y, r.width, r.height];
    let line = lines.at(-1);
    if (!line || line.boxes[0]![vertical ? 0 : 1] !== box[vertical ? 0 : 1]) {
      line = { text: "", start: index, boxes: [] };
      lines.push(line);
    }
    line.text += segment;
    line.boxes.push(box);
  }
  return lines;
}

/** 截图边界向外取整，保留描边和抗锯齿像素。 */
function text_bounds(boxes: number[][], padding: number): Rect {
  const x = Math.floor(Math.min(...boxes.map((b) => b[0]!)) - padding);
  const y = Math.floor(Math.min(...boxes.map((b) => b[1]!)) - padding);
  return {
    x,
    y,
    width: Math.ceil(Math.max(...boxes.map((b) => b[0]! + b[2]!)) + padding) - x,
    height: Math.ceil(Math.max(...boxes.map((b) => b[1]! + b[3]!)) + padding) - y,
  };
}

/** 字体与断行只由 Chromium 测量；归一化宽度表供所有字号和几何候选复用。 */
function* measure_widths(
  root: HTMLElement,
  maxLines: number,
  vertical: boolean,
): Generator<Step, number[]> {
  const bounds = root.getBoundingClientRect();
  const natural = vertical ? bounds.height : bounds.width;
  const lineHeight = RULES.measurementFontSize * RULES.lineHeight;
  const count = (width: number) => {
    root.style.inlineSize = width + "px";
    const rect = root.getBoundingClientRect();
    return Math.round((vertical ? rect.width : rect.height) / lineHeight);
  };
  const minimum = count(natural);
  const widths = Array<number>(maxLines + 1).fill(Infinity);
  let high = natural;
  for (let lines = minimum; lines <= maxLines; lines++) {
    let lo = 0,
      hi = high;
    while (hi - lo > RULES.measurementPrecision) {
      const middle = (lo + hi) / 2;
      if (count(middle) <= lines) hi = middle;
      else lo = middle;
    }
    widths[lines] = hi;
    high = hi;
    if (lines % RULES.progressInterval === 0) yield { kind: "progress" };
  }
  return widths;
}

/** 原生截图必须保持一比一像素，后续距离判断使用原图坐标。 */
async function decode(png: string | undefined, width: number, height: number) {
  if (!png) throw new Error("Missing native text screenshot");
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

/** 搜索期间不生成像素。一次定稿截图同时包含原段落及隔离行，验证后按整数像素居中。 */
export async function* render_page(
  page: ImageTextPage,
  fontCss: string,
): AsyncGenerator<Step, ImageTextPaint[], string | undefined> {
  document.documentElement.removeAttribute("lang");
  const style = document.createElement("style");
  style.textContent =
    fontCss + "html,body{margin:0;background:transparent}*{box-sizing:border-box}";
  document.head.replaceChildren(style);
  const output: ImageTextPaint[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const region of page.regions) {
    const [originX, originY, width, height] = region.box;
    const vertical = region.direction === "vertical-rl";
    const inline = vertical ? height : width,
      block = vertical ? width : height;
    const graphemes = Array.from(segmenter.segment(region.text));
    const bytes = Uint8Array.from(atob(region.distance), (c) => c.charCodeAt(0));
    const distance = new Float32Array(bytes.buffer);
    const root = document.createElement("div");
    const content = document.createElement("span");
    content.id = "image-text-content";
    content.textContent = region.text;
    root.append(content);
    document.body.replaceChildren(root);
    const base = `position:absolute;writing-mode:${region.direction};font-family:ImageText;font-synthesis:none;line-height:${RULES.lineHeight};white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;text-align:center;block-size:max-content;`;
    root.style.cssText = base + `font-size:${RULES.measurementFontSize}px;inline-size:max-content;`;
    await document.fonts.load(`${RULES.measurementFontSize}px ImageText`, region.text);
    if (!document.fonts.check(`${RULES.measurementFontSize}px ImageText`, region.text))
      throw new Error("Image text font unavailable");
    yield {
      kind: "resize",
      width: Math.max(width, RULES.measurementFontSize),
      height: Math.max(height, RULES.measurementFontSize),
    };
    if ((yield { kind: "font_check" }) === "missing_glyph") {
      output.push({
        result: {
          regionId: region.regionId,
          blockId: region.blockId,
          text: region.text,
          box: region.box,
          status: "failed",
          reason: "missing_glyph",
        },
      });
      continue;
    }
    const maxLines = Math.min(
      graphemes.length + 1,
      Math.floor(block / (RULES.minimumFontSize * RULES.lineHeight)),
    );
    const widths = yield* measure_widths(root, maxLines, vertical);
    let maximumDistance = 0;
    for (const value of distance) maximumDistance = Math.max(maximumDistance, value);
    const firstSize = Math.min(
      inline,
      Math.ceil((maximumDistance - RULES.squareDistanceCorrection) / RULES.marginRatio),
    );
    const ink = image_text_color(region.fill.color),
      stroke = ink === "black" ? "white" : "black";
    let found: ImageTextPaint | undefined;
    for (let size = firstSize; size >= RULES.minimumFontSize && !found; size--) {
      if (size % RULES.progressInterval === 0) yield { kind: "progress" };
      const strokeWidth = Math.max(RULES.minimumStroke, size * RULES.strokeRatio);
      for (const rectangle of image_text_rectangles(region, distance, size, widths)) {
        const pad = size * 2;
        const x = vertical
          ? width - rectangle.blockStart - rectangle.blockSize
          : rectangle.inlineStart;
        const y = vertical ? rectangle.inlineStart : rectangle.blockStart;
        root.style.cssText =
          base +
          `left:${x + pad}px;top:${y + pad}px;inline-size:${rectangle.inlineSize}px;font-size:${size}px;color:${ink};-webkit-text-stroke:${strokeWidth}px ${stroke};paint-order:stroke fill;`;
        content.textContent = region.text;
        document.body.replaceChildren(root);
        const bounds = root.getBoundingClientRect();
        // 归一化度量只产生候选，最终字号的原生断行仍需符合候选矩形。
        if (
          (vertical ? bounds.width : bounds.height) >
          rectangle.blockSize + RULES.measurementPrecision
        )
          continue;
        const lines = text_lines(content, graphemes, vertical);
        const fullRect = text_bounds(
          lines.flatMap((l) => l.boxes),
          pad,
        );
        const tiles: Tile[] = [
          { element: root.cloneNode(true) as HTMLElement, rect: fullRect, x: 0, y: 0 },
        ];
        content.replaceChildren(
          ...lines.map((line) => {
            const span = document.createElement("span");
            span.textContent = line.text;
            return span;
          }),
        );
        const isolated = text_lines(content, graphemes, vertical);
        if (JSON.stringify(isolated) !== JSON.stringify(lines)) continue;
        for (const [index, line] of lines.entries()) {
          const element = root.cloneNode(true) as HTMLElement;
          Array.from(element.querySelector("#image-text-content")!.children, (child, i) => {
            (child as HTMLElement).style.visibility = i === index ? "visible" : "hidden";
          });
          tiles.push({ element, rect: text_bounds(line.boxes, pad), x: 0, y: 0 });
        }
        let atlasWidth = 0,
          atlasHeight = 0,
          nextX = 0,
          nextY = 0,
          rowHeight = 0;
        for (const tile of tiles) {
          if (nextX + tile.rect.width > RULES.atlasMaximumEdge) {
            nextX = 0;
            nextY += rowHeight;
            rowHeight = 0;
          }
          tile.x = nextX;
          tile.y = nextY;
          tile.element.style.left =
            parseFloat(tile.element.style.left) + tile.x - tile.rect.x + "px";
          tile.element.style.top = parseFloat(tile.element.style.top) + tile.y - tile.rect.y + "px";
          nextX += tile.rect.width;
          rowHeight = Math.max(rowHeight, tile.rect.height);
          atlasWidth = Math.max(atlasWidth, nextX);
          atlasHeight = Math.max(atlasHeight, nextY + rowHeight);
        }
        if (
          atlasWidth > RULES.atlasMaximumEdge ||
          atlasHeight > RULES.atlasMaximumEdge ||
          atlasWidth * atlasHeight > RULES.atlasMaximumPixels
        )
          throw new Error("Image text final raster exceeds pixel budget");
        document.body.replaceChildren(...tiles.map((t) => t.element));
        yield { kind: "resize", width: atlasWidth, height: atlasHeight };
        const context = await decode(
          yield { kind: "capture", rect: { x: 0, y: 0, width: atlasWidth, height: atlasHeight } },
          atlasWidth,
          atlasHeight,
        );
        const full = context.getImageData(0, 0, fullRect.width, fullRect.height);
        const colors = new Uint32Array(full.data.buffer);
        const coverage = new Uint32Array(colors.length);
        let valid = true;
        for (const tile of tiles.slice(1)) {
          const data = context.getImageData(tile.x, tile.y, tile.rect.width, tile.rect.height).data;
          const rgba = new Uint32Array(data.buffer);
          for (let i = 0; i < rgba.length; i++) {
            if (!data[i * 4 + 3]) continue;
            const px = (i % tile.rect.width) + tile.rect.x - fullRect.x;
            const py = Math.floor(i / tile.rect.width) + tile.rect.y - fullRect.y;
            if (px < 0 || py < 0 || px >= fullRect.width || py >= fullRect.height) {
              valid = false;
              break;
            }
            const at = py * fullRect.width + px;
            if (coverage[at]) {
              valid = false;
              break;
            }
            coverage[at] = rgba[i]!;
          }
          if (!valid) break;
        }
        if (!valid || colors.some((c, i) => c !== coverage[i])) continue;
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (let i = 0; i < colors.length; i++)
          if (full.data[i * 4 + 3]) {
            const px = (i % fullRect.width) + fullRect.x - pad,
              py = Math.floor(i / fullRect.width) + fullRect.y - pad;
            x0 = Math.min(x0, px);
            y0 = Math.min(y0, py);
            x1 = Math.max(x1, px + 1);
            y1 = Math.max(y1, py + 1);
          }
        if (!Number.isFinite(x0)) continue;
        const shift = Math.round(
          region.centroid[vertical ? 0 : 1] - (vertical ? (x0 + x1) / 2 : (y0 + y1) / 2),
        );
        const dx = vertical ? shift : 0,
          dy = vertical ? 0 : shift;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const painted = canvas.getContext("2d")!;
        const pixels = painted.createImageData(width, height);
        const resultColors = new Uint32Array(pixels.data.buffer);
        let lower = Infinity;
        for (let i = 0; i < colors.length; i++)
          if (full.data[i * 4 + 3]) {
            const px = (i % fullRect.width) + fullRect.x - pad + dx,
              py = Math.floor(i / fullRect.width) + fullRect.y - pad + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) {
              valid = false;
              break;
            }
            lower = Math.min(lower, distance[py * width + px]! - RULES.squareDistanceCorrection);
            if (lower < image_text_margin(size)) {
              valid = false;
              break;
            }
            resultColors[py * width + px] = colors[i]!;
          }
        if (!valid) continue;
        const centerError = Math.abs(
          region.centroid[vertical ? 0 : 1] - (vertical ? (x0 + x1) / 2 + dx : (y0 + y1) / 2 + dy),
        );
        if (centerError > Math.max(RULES.minimumCenterTolerance, size * RULES.centerToleranceRatio))
          continue;
        painted.putImageData(pixels, 0, 0);
        found = {
          result: {
            regionId: region.regionId,
            blockId: region.blockId,
            text: region.text,
            box: region.box,
            status: "rendered",
            fontSize: size,
            strokeWidth,
            margin: lower,
            bounds: [x0 + dx + originX, y0 + dy + originY, x1 + dx + originX, y1 + dy + originY],
            centerError,
            warnings: size < RULES.smallFontSize ? ["small_font"] : [],
          },
          png: canvas.toDataURL("image/png").split(",")[1]!,
        };
        break;
      }
    }
    output.push(
      found ?? {
        result: {
          regionId: region.regionId,
          blockId: region.blockId,
          text: region.text,
          box: region.box,
          status: "failed",
          reason: "no_fit",
        },
      },
    );
    document.body.replaceChildren();
  }
  return output;
}
