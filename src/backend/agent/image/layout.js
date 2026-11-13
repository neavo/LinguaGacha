const stage = document.querySelector("#stage"),
  measure = document.querySelector("#measure");
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });

const font = (size) => `${weight} ${size}px LG`;
let weight = 400;
let frame; // 当前分块只保留画布尺寸和旋转，不持有原文与掩码副本。
/** 只通过 textContent 建立字面文本，宿主随后复用生成的固定片段。 */
function node(text, x, y, size, lh, width, height, vertical = false) {
  const el = document.createElement("div");
  el.className = "text";
  el.textContent = text;
  el.style.fontWeight = String(weight);
  Object.assign(el.style, {
    left: `${x}px`,
    top: `${y}px`,
    fontSize: `${size}px`,
    lineHeight: `${lh}px`,
    width: `${width}px`,
    height: `${height}px`,
    writingMode: vertical ? "vertical-rl" : "horizontal-tb",
  });
  stage.append(el);
  return el;
}
/** 先逆向旋转安全掩码，再在未旋转的坐标中寻找布局。 */
async function bitmap(url, w, h, angle = 0) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return Uint8Array.from({ length: w * h }, (_, i) =>
    rgba[i * 4] > 250 && rgba[i * 4 + 3] > 250 ? 1 : 0,
  );
}
/** 整行或整列必须全部落在安全区内，中心线相交不足以保护字形。 */
function longestBand(mask, w, h, start, thickness, vertical) {
  const first = Math.floor(start),
    last = Math.ceil(start + thickness);
  const primary = vertical ? w : h,
    secondary = vertical ? h : w;
  if (first < 0 || last > primary) return null;
  let best = null,
    begin = -1,
    intervals = 0;
  for (let a = 0; a <= secondary; a++) {
    let inside = a < secondary;
    for (let b = first; inside && b < last; b++)
      if (!mask[vertical ? a * w + b : b * w + a]) inside = false;
    if (inside && begin < 0) begin = a;
    if (!inside && begin >= 0) {
      const candidate = [begin, a];
      if (a - begin >= 3) intervals++;
      if (!best || a - begin > best[1] - best[0]) best = candidate;
      begin = -1;
    }
  }
  if (best) best.intervals = intervals;
  return best;
}
/** 按字素读取 Chromium 的首行范围，显式换行单独消费。 */
function nativeFirst(text, available, size, lh, vertical) {
  if (!text) return null;
  // Chromium 处理段内标点与混合字形，显式换行在段末消费。
  const newline = text.indexOf("\n");
  const paragraph = newline < 0 ? text : text.slice(0, newline);
  if (!paragraph) return { text: "", used: 1, width: 0 };
  measure.textContent = paragraph;
  Object.assign(measure.style, {
    fontSize: `${size}px`,
    lineHeight: `${lh}px`,
    width: vertical ? "max-content" : `${available}px`,
    height: vertical ? `${available}px` : "max-content",
    writingMode: vertical ? "vertical-rl" : "horizontal-tb",
  });
  const range = document.createRange();
  let axis = null,
    end = 0,
    lo = Infinity,
    hi = -Infinity;
  for (const part of segmenter.segment(paragraph)) {
    range.setStart(measure.firstChild, part.index);
    range.setEnd(measure.firstChild, part.index + part.segment.length);
    const box = range.getBoundingClientRect(),
      value = vertical ? box.right : box.top;
    if (axis === null) axis = value;
    if (Math.abs(value - axis) > size * 0.6) break;
    end = part.index + part.segment.length;
    lo = Math.min(lo, vertical ? box.top : box.left);
    hi = Math.max(hi, vertical ? box.bottom : box.right);
  }
  if (!end) return null;
  return {
    text: paragraph.slice(0, end),
    used: end + (end === paragraph.length && newline >= 0 ? 1 : 0),
    width: hi - lo,
  };
}
/** 单个字号尝试均衡矩形，字号搜索只由外层负责。 */
function rectangle(c, size) {
  const [x, y, w, h] = c.rect,
    vertical = c.direction === "vertical-rl";

  for (const ratio of [1.2, 1.35]) {
    measure.textContent = c.text;
    Object.assign(measure.style, {
      fontSize: `${size}px`,
      lineHeight: `${size * ratio}px`,
      width: vertical ? "max-content" : `${w}px`,
      height: vertical ? `${h}px` : "max-content",
      writingMode: c.direction,
      textWrap: "balance",
    });
    const rect = measure.getBoundingClientRect();
    if (
      Math.max(rect.width, measure.scrollWidth) > w + 0.1 ||
      Math.max(rect.height, measure.scrollHeight) > h + 0.1
    )
      continue;
    const el = node(
      c.text,
      x + (w - rect.width) / 2,
      y + (h - rect.height) / 2,
      size,
      size * ratio,
      rect.width,
      rect.height,
      vertical,
    );
    el.style.textWrap = "balance";
    el.style.textAlign = "center";
    return { complete: true };
  }

  return { complete: false };
}
/** 单个字号搜索完整行带，拒绝需要跨孔洞跳读的结果。 */
function contour(c, mask, size) {
  const vertical = c.direction === "vertical-rl";
  measure.style.textWrap = "wrap";

  let best = null;
  for (const ratio of [1.2, 1.35]) {
    const lh = Math.ceil(size * ratio),
      primary = vertical ? c.width : c.height;
    const maxLines = Math.min(24, Math.floor(primary / lh));
    for (let count = 1; count <= maxLines; count++)
      for (const shift of [0, -0.1, 0.1]) {
        const offset = Math.round((primary - count * lh) / 2 + primary * shift);
        let used = 0,
          lines = [],
          valid = true;
        for (let i = 0; i < count; i++) {
          const start = vertical ? offset + (count - 1 - i) * lh : offset + i * lh;
          const span = longestBand(mask, c.width, c.height, start, lh, vertical);
          if (!span || span[1] - span[0] < size * 1.25) {
            valid = false;
            break;
          }
          const part = nativeFirst(c.text.slice(used), span[1] - span[0], size, lh, vertical);
          if (!part) break;
          used += part.used;
          lines.push({ text: part.text, start, span, width: part.width, lh });
          const finished = used >= c.text.length;
          if (finished) break;
        }
        const complete = used >= c.text.length;
        if (!valid || !complete || !lines.length) continue;
        const widths = lines.map((l) => l.width),
          mean = widths.reduce((a, b) => a + b, 0) / widths.length;
        const ragged =
          widths.reduce((a, b) => a + Math.abs(b - mean), 0) / Math.max(1, mean * widths.length);
        const centre =
          (Math.min(...lines.map((l) => l.start)) + Math.max(...lines.map((l) => l.start + lh))) /
          2;
        const score =
          Math.abs(centre - primary / 2) / primary + ragged * 0.12 + (ratio - 1.2) * 0.1;
        if (!best || score < best.score) best = { lines, score, size };
      }
  }
  if (best) {
    for (const l of best.lines) {
      if (vertical) {
        const el = node(
          l.text,
          l.start,
          (l.span[0] + l.span[1] - l.width) / 2,
          size,
          l.lh,
          l.lh,
          Math.ceil(l.width) + 1,
          true,
        );
        el.style.whiteSpace = "pre";
      } else {
        const el = node(
          l.text,
          (l.span[0] + l.span[1] - l.width) / 2,
          l.start,
          size,
          l.lh,
          Math.ceil(l.width) + 1,
          l.lh,
        );
        el.style.whiteSpace = "pre";
      }
    }
    return { complete: true, splitBands: best.lines.some((line) => line.span.intervals > 1) };
  }

  return { complete: false };
}

/** 逐行累计高度，用单调栈寻找轮廓内最大矩形。 */
function largestRectangle(mask, w, h) {
  const heights = new Int32Array(w);
  let best = [0, 0, 0, 0],
    area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= w; x++) {
      const current = x < w ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] > current) {
        const [left, height] = stack.pop();
        if ((x - left) * height > area) {
          area = (x - left) * height;
          best = [left, y - height + 1, x - left, height];
        }
        start = left;
      }
      if (!stack.length || stack[stack.length - 1][1] < current) stack.push([start, current]);
    }
  }
  return best;
}
/** 先估计目标字体的比例，再测邻近字号，避免建立整张字号表。 */
function calibrate(value, vertical, maximum) {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  const measureInk = (size) => {
    canvas.width = canvas.height = Math.ceil(size * 2);
    ctx.font = font(size);
    ctx.textBaseline = "top";
    const dimensions = [];
    for (const glyph of ["国", "語", "翻", "譯"]) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(glyph, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lo = Infinity,
        hi = -1;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (data[(y * canvas.width + x) * 4 + 3] > 8) {
            const axis = vertical ? x : y;
            lo = Math.min(lo, axis);
            hi = Math.max(hi, axis);
          }
      if (hi >= lo) dimensions.push(hi - lo + 1);
    }
    return dimensions.reduce((a, b) => a + b, 0) / dimensions.length;
  };
  const estimate = Math.round((value * 64) / measureInk(64));
  if (estimate < 1 || estimate > maximum) return null;
  let best = null,
    distance = Infinity;
  for (let size = Math.max(1, estimate - 2); size <= Math.min(maximum, estimate + 2); size++) {
    const delta = Math.abs(measureInk(size) - value);
    if (delta < distance) {
      distance = delta;
      best = size;
    }
  }
  return best;
}
/** 几何候选按字号排序，实际绘制边界由宿主逐个验证。 */
window.imageCandidates = async (c) => {
  weight = c.style.weight;
  measure.style.fontWeight = String(weight);
  await document.fonts.load(font(Math.max(c.width, c.height)), c.text + "国語翻譯");
  await document.fonts.ready;
  const mask = await bitmap(c.mask, c.width, c.height, c.style.rotation);
  const rect = largestRectangle(mask, c.width, c.height);
  const upper = Math.floor((c.direction === "vertical-rl" ? c.width : c.height) / 1.2);
  const reference =
    c.style.fontSize ??
    (c.measurement.status === "measured"
      ? calibrate(c.measurement.value, c.direction === "vertical-rl", upper)
      : null);
  const max = reference === null ? upper : Math.max(c.style.minFontSize, reference);
  const candidates = [];
  frame = { width: c.width, height: c.height, rotation: c.style.rotation };
  if (c.text === "") return [{ size: 0, html: "" }];
  const capture = (result, chosen, size) => {
    if (!result.complete || result.splitBands > 0) return;
    for (const el of stage.children) {
      el.style.color = c.style.color;
      el.style.webkitTextStroke = `${c.style.strokeWidth}px ${c.style.stroke}`;
      el.style.paintOrder = "stroke fill";
    }
    candidates.push({ size, chosen, html: stage.innerHTML });
  };
  const context = { ...c, rect };
  for (let size = Math.ceil(c.style.minFontSize); size <= max; size++) {
    stage.replaceChildren();
    capture(rectangle(context, size), "rectangle", size);
    stage.replaceChildren();
    capture(contour(c, mask, size), "contour", size);
  }
  candidates.sort((a, b) => b.size - a.size || (a.chosen === "rectangle" ? -1 : 1));
  if (reference !== null) {
    const rectangle = candidates.find((c) => c.chosen === "rectangle");
    if (rectangle && (rectangle.size >= reference || candidates[0].size < rectangle.size * 1.1)) {
      candidates.splice(candidates.indexOf(rectangle), 1);
      candidates.unshift(rectangle);
    }
  }
  stage.replaceChildren();
  return candidates.map(({ size, html }) => ({ size, html }));
};
/** 分块只移动同一布局，避免每块重新断行产生接缝。 */
window.imageRender = async (html, x, y) => {
  const c = frame;
  stage.innerHTML = html;
  Object.assign(stage.style, {
    width: `${c.width}px`,
    height: `${c.height}px`,
    left: `${-x}px`,
    top: `${-y}px`,
    transform: `rotate(${c.rotation}deg)`,
  });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
