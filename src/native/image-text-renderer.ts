import { layoutNextLine, prepareWithSegments, type LayoutCursor } from "@chenglou/pretext";
import {
  IMAGE_TEXT_RULES as RULES,
  image_text_color,
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
type PlannedBlock = { block: Block; fontSize: number; lines: PlannedLine[] };
type PlannedRegion = {
  candidateId: string;
  blocks: PlannedBlock[];
  score: number;
};

/** helper 输出 little-endian Float32 距离场，浏览器按原字节读取。 */
function decode_distance(block: Block): Float32Array {
  const bytes = Uint8Array.from(atob(block.distance), (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

/** 文本游标是动态规划合并等价状态的唯一键。 */
function cursor_key(cursor: LayoutCursor | undefined): string {
  return cursor ? `${cursor.segmentIndex}:${cursor.graphemeIndex}` : "start";
}

/** 按一组槽位继续消费正文，返回该块实际使用的行。 */
function flow_block(
  prepared: ReturnType<typeof prepareWithSegments>,
  slots: readonly TextSlot[],
  cursor: LayoutCursor | undefined,
): { lines: PlannedLine[]; cursor: LayoutCursor } | undefined {
  const lines: PlannedLine[] = [];
  let next = cursor;
  for (const slot of slots) {
    const line = layoutNextLine(prepared, slot.inlineHigh - slot.inlineLow, next);
    if (!line) return undefined;
    lines.push({ text: line.text, width: line.width, slot, inlineStart: slot.inlineLow });
    next = line.end;
  }
  return next ? { lines, cursor: next } : undefined;
}

/** 横排逐行居中；竖排各行沿内联轴共用源文字中心。 */
function position_lines(
  direction: Region["direction"],
  block: Block,
  lines: PlannedLine[],
): boolean {
  if (direction === "vertical-rl") {
    const lower = Math.max(...lines.map((line) => line.slot.inlineLow));
    const upper = Math.min(...lines.map((line) => line.slot.inlineHigh - line.width));
    if (upper < lower) return false;
    const target = block.sourceCenter[1] - Math.max(...lines.map((line) => line.width)) / 2;
    const start = Math.max(lower, Math.min(upper, target));
    for (const line of lines) line.inlineStart = start;
  } else {
    for (const line of lines)
      line.inlineStart =
        line.slot.inlineLow + (line.slot.inlineHigh - line.slot.inlineLow - line.width) / 2;
  }
  return true;
}

/** 比较译文与源文字的墨迹面积、中心、齐整度和避头尾禁则。 */
function block_cost(direction: Region["direction"], planned: PlannedBlock): number {
  const { block, lines } = planned;
  const horizontal = direction !== "vertical-rl";
  let area = 0;
  let centerX = 0;
  let centerY = 0;
  let ragged = 0;
  let linePenalty = 0;
  for (const line of lines) {
    const lineArea = line.width * line.slot.blockSize;
    const x = horizontal
      ? line.inlineStart + line.width / 2
      : block.box[2] - line.slot.blockStart - line.slot.blockSize / 2;
    const y = horizontal
      ? line.slot.blockStart + line.slot.blockSize / 2
      : line.inlineStart + line.width / 2;
    area += lineArea;
    centerX += x * lineArea;
    centerY += y * lineArea;
    const capacity = line.slot.inlineHigh - line.slot.inlineLow;
    ragged += ((capacity - line.width) / capacity) ** 2;
    const text = line.text.trim();
    if (/^[,.;:!?，。；：！？、）》」』】〕〉〗〙〛]/u.test(text)) linePenalty++;
    if (/[（《「『【〔〈〖〘〚]$/u.test(text)) linePenalty++;
    if (lines.length > 1 && Array.from(text).length === 1) linePenalty++;
  }
  const shortSide = Math.min(block.box[2], block.box[3]);
  const centerCost =
    ((centerX / area - block.sourceCenter[0]) ** 2 +
      (centerY / area - block.sourceCenter[1]) ** 2) /
    shortSide ** 2;
  return (
    Math.abs(Math.log(area / block.sourceEnvelopeArea)) +
    centerCost +
    ragged / lines.length +
    linePenalty / lines.length
  );
}

type PartialPlan = {
  cursor: LayoutCursor | undefined;
  blocks: PlannedBlock[];
  score: number;
};

/** 同一文本游标只保留最低成本、最少块的方案。 */
function better_plan(a: PartialPlan, b: PartialPlan | undefined): boolean {
  return !b || a.score < b.score || (a.score === b.score && a.blocks.length < b.blocks.length);
}

/** 文本游标与块位置组成动态规划状态；每个源文本单元最多消费一次。 */
function plan_candidate(
  region: Region,
  candidate: Candidate,
  distances: readonly Float32Array[],
  completion: ReturnType<typeof prepareWithSegments>,
  scale: number,
): PlannedRegion | undefined {
  const totalSourceArea = candidate.blocks.reduce(
    (sum, block) => sum + block.sourceEnvelopeArea,
    0,
  );
  let states = new Map<string, PartialPlan>([
    ["start", { cursor: undefined, blocks: [], score: 0 }],
  ]);
  for (const [blockIndex, block] of candidate.blocks.entries()) {
    const nextStates = new Map<string, PartialPlan>();
    const fontSize = Math.round(block.preferredFontSize * scale);
    const prepared =
      fontSize >= RULES.minimumFontSize
        ? prepareWithSegments(region.text, `${fontSize}px ImageText`, { whiteSpace: "pre-wrap" })
        : undefined;
    const slotSets = prepared
      ? image_text_slot_sets(block, region.direction, distances[blockIndex]!, fontSize)
      : [];
    for (const state of states.values()) {
      const empty = {
        ...state,
        score: state.score + block.sourceEnvelopeArea / totalSourceArea,
      };
      const emptyKey = cursor_key(empty.cursor);
      if (better_plan(empty, nextStates.get(emptyKey))) nextStates.set(emptyKey, empty);
      if (!prepared) continue;
      for (const slots of slotSets) {
        const flowed = flow_block(prepared, slots, state.cursor);
        if (!flowed || !position_lines(region.direction, block, flowed.lines)) continue;
        const plannedBlock = { block, fontSize, lines: flowed.lines };
        const cost = block_cost(region.direction, plannedBlock);
        if (!Number.isFinite(cost)) continue;
        const next = {
          cursor: flowed.cursor,
          blocks: [...state.blocks, plannedBlock],
          score: state.score + (block.sourceEnvelopeArea / totalSourceArea) * cost,
        };
        const key = cursor_key(next.cursor);
        if (better_plan(next, nextStates.get(key))) nextStates.set(key, next);
      }
    }
    states = nextStates;
  }
  const complete = [...states.values()].filter(
    (state) =>
      state.cursor &&
      state.blocks.length > 0 &&
      layoutNextLine(completion, Number.MAX_SAFE_INTEGER, state.cursor) === null,
  );
  complete.sort((a, b) => a.score - b.score || a.blocks.length - b.blocks.length);
  return complete[0] ? { candidateId: candidate.candidateId, ...complete[0] } : undefined;
}

/** 从视觉块可用尺度到最小字号枚举共同缩放，并合并相同字号组合。 */
function candidate_scales(candidate: Candidate): number[] {
  const maximum = Math.max(
    ...candidate.blocks.map(
      (block) => Math.min(block.box[2], block.box[3]) / block.preferredFontSize,
    ),
  );
  const minimum = Math.min(
    ...candidate.blocks.map((block) => RULES.minimumFontSize / block.preferredFontSize),
  );
  const scales = new Set([maximum, 1, minimum]);
  for (let scale = maximum; scale > minimum; scale /= RULES.lineHeight) scales.add(scale);
  const fontSizes = new Set<string>();
  return [...scales].filter((scale) => {
    if (scale < minimum || scale > maximum) return false;
    const key = candidate.blocks
      .map((block) => Math.round(block.preferredFontSize * scale))
      .join("/");
    if (fontSizes.has(key)) return false;
    fontSizes.add(key);
    return true;
  });
}

/** 比较所有视觉候选和共同缩放比例，选择完整、安全且最接近源稿的稳定方案。 */
function plan_region(region: Region): PlannedRegion | undefined {
  const completion = prepareWithSegments(region.text, "16px ImageText", { whiteSpace: "pre-wrap" });
  const plans = region.candidates.flatMap((candidate) => {
    const distances = candidate.blocks.map(decode_distance);
    return candidate_scales(candidate)
      .map((scale) => plan_candidate(region, candidate, distances, completion, scale))
      .filter((plan): plan is PlannedRegion => plan !== undefined);
  });
  plans.sort(
    (a, b) =>
      a.score - b.score ||
      a.blocks.length - b.blocks.length ||
      a.candidateId.localeCompare(b.candidateId),
  );
  return plans[0];
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

/** Pretext 搜索断行，Chromium 只绘制最终候选，距离场验收最终像素。 */
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
    await document.fonts.load(`16px ImageText`, region.text);
    if (!document.fonts.check(`16px ImageText`, region.text))
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
    for (const plannedBlock of planned.blocks) {
      const strokeWidth = Math.max(RULES.minimumStroke, plannedBlock.fontSize * RULES.strokeRatio);
      const [, , width, height] = plannedBlock.block.box;
      const root = document.createElement("div");
      root.style.cssText = `position:relative;width:${width}px;height:${height}px`;
      for (const line of plannedBlock.lines) {
        const element = document.createElement("span");
        element.textContent = line.text;
        element.style.cssText =
          `position:absolute;font-family:ImageText;font-size:${plannedBlock.fontSize}px;` +
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
      let margin = Infinity;
      for (let index = 0; index < width * height; index++) {
        if (!pixels.data[index * 4 + 3]) continue;
        margin = Math.min(margin, distance[index]! - RULES.squareDistanceCorrection);
      }
      if (!Number.isFinite(margin) || margin < 0)
        throw new Error(`Image text left layout area: ${page.pageId}/${region.regionId}`);
      output.push({
        result: {
          regionId: region.regionId,
          box: plannedBlock.block.box,
          renderStatus: "success",
        },
        png: png!,
      });
    }
  }
  document.body.replaceChildren();
  return output;
}
