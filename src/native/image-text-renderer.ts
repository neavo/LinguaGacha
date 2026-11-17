import { layoutNextLine, prepareWithSegments, type LayoutCursor } from "@chenglou/pretext";
import {
  IMAGE_TEXT_RULES as RULES,
  image_text_color,
  image_text_margin,
  type ImageTextPage,
  type ImageTextPaint,
} from "../shared/image-text";
import { image_text_slot_sets, type TextSlot } from "./image-text-layout";

type Step =
  | { kind: "capture"; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "resize"; width: number; height: number }
  | { kind: "progress" };
type Region = ImageTextPage["regions"][number];
type Candidate = Region["candidates"][number];
type Block = Candidate["blocks"][number];
type PlannedLine = { text: string; width: number; slot: TextSlot; inlineStart: number };
type PlannedBlock = { block: Block; lines: PlannedLine[] };
type PlannedRegion = {
  candidate: Candidate;
  fontSize: number;
  blocks: PlannedBlock[];
  score: number;
};

function decode_distance(block: Block): Float32Array {
  const bytes = Uint8Array.from(atob(block.distance), (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

/** 每个块选择一种行槽集合。候选最多两个块，组合规模由材料上限约束。 */
function combinations<T>(values: readonly T[][]): T[][] {
  return values.reduce<T[][]>(
    (result, items) => result.flatMap((prefix) => items.map((item) => [...prefix, item])),
    [[]],
  );
}

/** 为固定字号枚举可容纳完整正文的候选；几何块可以不使用。 */
function plan_candidate(region: Region, candidate: Candidate, fontSize: number): PlannedRegion[] {
  const prepared = prepareWithSegments(region.text, `${fontSize}px ImageText`, {
    whiteSpace: "pre-wrap",
  });
  const slotSets = candidate.blocks.map((block) =>
    image_text_slot_sets(block, region.direction, decode_distance(block), fontSize),
  );
  const plans: PlannedRegion[] = [];
  for (const selectedSets of combinations(slotSets.map((sets) => [[], ...sets]))) {
    const entries = selectedSets.flatMap((slots, blockIndex) =>
      slots.map((slot) => ({ blockIndex, slot })),
    );
    const lines: (PlannedLine & { blockIndex: number })[] = [];
    let cursor: LayoutCursor | undefined;
    for (const entry of entries) {
      const line = layoutNextLine(prepared, entry.slot.inlineHigh - entry.slot.inlineLow, cursor);
      if (!line) break;
      lines.push({
        blockIndex: entry.blockIndex,
        text: line.text,
        width: line.width,
        slot: entry.slot,
        inlineStart: entry.slot.inlineLow,
      });
      cursor = line.end;
    }
    if (!cursor || layoutNextLine(prepared, Number.MAX_SAFE_INTEGER, cursor) !== null) continue;
    const blocks = candidate.blocks
      .map((block, blockIndex) => ({
        block,
        lines: lines.filter((line) => line.blockIndex === blockIndex),
      }))
      .filter((block) => block.lines.length > 0);
    let valid = true;
    for (const block of blocks) {
      if (region.direction === "vertical-rl") {
        const lower = Math.max(...block.lines.map((line) => line.slot.inlineLow));
        const upper = Math.min(...block.lines.map((line) => line.slot.inlineHigh - line.width));
        if (upper < lower) {
          valid = false;
          break;
        }
        const target =
          block.block.centroid[1] - Math.max(...block.lines.map((line) => line.width)) / 2;
        const start = Math.max(lower, Math.min(upper, target));
        for (const line of block.lines) line.inlineStart = start;
      } else {
        for (const line of block.lines)
          line.inlineStart =
            line.slot.inlineLow + (line.slot.inlineHigh - line.slot.inlineLow - line.width) / 2;
      }
    }
    if (!valid) continue;
    const score =
      Math.abs(lines.length - region.sourceLineCount) * 1000 +
      lines.reduce((sum, line) => {
        const capacity = line.slot.inlineHigh - line.slot.inlineLow;
        return sum + ((capacity - line.width) / capacity) ** 2;
      }, 0);
    plans.push({ candidate, fontSize, blocks, score });
  }
  return plans;
}

/** 字号从原文尺度递减，首个可行字号内选择得分最低的确定性方案。 */
function plan_region(region: Region): PlannedRegion | undefined {
  for (let fontSize = region.preferredFontSize; fontSize >= RULES.minimumFontSize; fontSize--) {
    const plans = region.candidates.flatMap((candidate) =>
      plan_candidate(region, candidate, fontSize),
    );
    plans.sort(
      (a, b) => a.score - b.score || a.candidate.candidateId.localeCompare(b.candidate.candidateId),
    );
    if (plans[0]) return plans[0];
  }
}

/** 将原生截图解码到一比一像素画布，供最终距离门禁读取 alpha。 */
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

/** Pretext 只搜索断行。Chromium 仅绘制最终候选，距离场继续执行最终像素门禁。 */
export async function* render_page(
  page: ImageTextPage,
  fontCss: string,
): AsyncGenerator<Step, ImageTextPaint[], string | undefined> {
  const style = document.createElement("style");
  style.textContent =
    fontCss +
    "html,body{margin:0;background:transparent}*{box-sizing:border-box}body{overflow:hidden}";
  document.head.replaceChildren(style);
  const output: ImageTextPaint[] = [];
  for (const region of page.regions) {
    await document.fonts.load(`${region.preferredFontSize}px ImageText`, region.text);
    if (!document.fonts.check(`${region.preferredFontSize}px ImageText`, region.text))
      throw new Error("Image text font unavailable");
    const planned = plan_region(region);
    if (!planned) {
      output.push({
        result: {
          regionId: region.regionId,
          renderStatus: "failure",
          reason: "layout_no_fit",
        },
      });
      continue;
    }
    const ink = image_text_color(region.fill.color);
    const stroke = ink === "black" ? "white" : "black";
    const strokeWidth = Math.max(RULES.minimumStroke, planned.fontSize * RULES.strokeRatio);
    for (const plannedBlock of planned.blocks) {
      const [, , width, height] = plannedBlock.block.box;
      const root = document.createElement("div");
      root.style.cssText = `position:relative;width:${width}px;height:${height}px`;
      for (const line of plannedBlock.lines) {
        const element = document.createElement("span");
        element.textContent = line.text;
        element.style.cssText =
          `position:absolute;font-family:ImageText;font-size:${planned.fontSize}px;` +
          `font-synthesis:none;line-height:1;white-space:pre;writing-mode:${region.direction};` +
          `color:${ink};-webkit-text-stroke:${strokeWidth}px ${stroke};paint-order:stroke fill;`;
        if (region.direction === "vertical-rl") {
          element.style.left = width - line.slot.blockStart - line.slot.blockSize + "px";
          element.style.top = line.inlineStart + "px";
        } else {
          element.style.left = line.inlineStart + "px";
          element.style.top = line.slot.blockStart + "px";
        }
        root.append(element);
      }
      document.body.replaceChildren(root);
      yield { kind: "resize", width, height };
      const png = yield { kind: "capture", rect: { x: 0, y: 0, width, height } };
      const context = await decode(png, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const distance = decode_distance(plannedBlock.block);
      let x0 = width,
        y0 = height,
        x1 = 0,
        y1 = 0,
        margin = Infinity;
      for (let index = 0; index < width * height; index++) {
        if (!pixels.data[index * 4 + 3]) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
        margin = Math.min(margin, distance[index]! - RULES.squareDistanceCorrection);
      }
      const centerError = Math.abs(
        region.direction === "vertical-rl"
          ? plannedBlock.block.centroid[0] - (x0 + x1) / 2
          : plannedBlock.block.centroid[1] - (y0 + y1) / 2,
      );
      const requiredMargin = image_text_margin(planned.fontSize);
      const allowedCenterError = Math.max(
        RULES.minimumCenterTolerance,
        planned.fontSize * RULES.centerToleranceRatio,
      );
      const valid = Number.isFinite(margin) && margin >= 0;
      const reasons = [
        ...(planned.fontSize < RULES.smallFontSize ? (["small_font"] as const) : []),
        ...(margin < requiredMargin ? (["tight_margin"] as const) : []),
        ...(centerError > allowedCenterError ? (["off_center"] as const) : []),
      ];
      const rendered = {
        regionId: region.regionId,
        box: plannedBlock.block.box,
      };
      const result: ImageTextPaint["result"] = valid
        ? reasons.length
          ? {
              ...rendered,
              renderStatus: "warning",
              reasons,
            }
          : {
              ...rendered,
              renderStatus: "success",
            }
        : {
            regionId: region.regionId,
            renderStatus: "failure",
            reason: "outside_layout_area",
          };
      output.push(valid ? { result, png: png! } : { result });
    }
  }
  document.body.replaceChildren();
  return output;
}
