const stage = document.querySelector("#stage"), // 实际截取分块像素的渲染舞台。
  measure = document.querySelector("#measure"); // 离屏测量自动换行与字号的隐藏容器。
const LINE_HEIGHT = 1.2, // 排版行高倍率。
  SEARCH_STEPS = 10; // 字号二分上限步数，兼顾精度与执行耗时。
const font = (size) => `${weight} ${size}px LG`; // 供 Font Loading API 加载对应字重的字体描述符。
let weight = 400; // 当前区域的字重缓存，供字体加载复用。
let frame; // 暂存当前区域尺寸与旋转角度，供分块截图使用。

/** 矩形内二分寻找最大可用字号，Chromium 负责换行和纵中横。 */
window.imageLayout = async (c) => {
  const style = {
    color: "#000000",
    stroke: "#ffffff",
    strokeWidth: 0,
    weight: 400,
    rotation: 0,
    minFontSize: 8,
    align: "center",
    ...c.style,
  };
  weight = style.weight;
  await document.fonts.load(font(style.fontSize ?? 64), c.text);
  await document.fonts.ready;
  frame = { width: c.width, height: c.height, rotation: style.rotation };
  if (!c.text.trim()) return { size: 0, html: "" };
  const vertical = c.direction === "vertical-rl";
  const minDim = Math.min(c.width, c.height);
  const inset = Math.ceil(style.strokeWidth) + (minDim < 45 ? 1 : 3);
  const angle = (Math.abs(style.rotation) * Math.PI) / 180;
  // 将可用矩形等比内缩，旋转后的四角仍落在原框内。
  const scale = Math.min(
    c.width / (c.width * Math.cos(angle) + c.height * Math.sin(angle)),
    c.height / (c.height * Math.cos(angle) + c.width * Math.sin(angle)),
  );
  const width = c.width * scale - inset * 2,
    height = c.height * scale - inset * 2;
  if (width <= 0 || height <= 0) return null;
  measure.replaceChildren();
  /** 写入文本内容；竖排时将独立两位数字包成纵中横。 */
  const addText = (target) => {
    if (!vertical) {
      target.textContent = c.text;
      return;
    }
    // Chromium 支持 all，digits 2 尚未实现，显式包住独立两位数字。
    for (const part of c.text.split(/((?<!\d)\d{2}(?!\d))/u)) {
      if (/^\d{2}$/u.test(part)) {
        const digits = document.createElement("span");
        digits.style.textCombineUpright = "all";
        digits.textContent = part;
        target.append(digits);
      } else target.append(document.createTextNode(part));
    }
  };
  addText(measure);
  const textWrap = !vertical && style.align !== "start" ? "balance" : "wrap";
  Object.assign(measure.style, {
    fontWeight: String(weight),
    writingMode: c.direction,
    width: vertical ? "max-content" : `${width}px`,
    height: vertical ? `${height}px` : "max-content",
    textAlign: style.align,
    textWrap,
  });
  /** 检测给定字号在约束矩形内是否不发生溢出。 */
  const fits = (size) => {
    measure.style.fontSize = `${size}px`;
    measure.style.lineHeight = `${size * LINE_HEIGHT}px`;
    const box = measure.getBoundingClientRect();
    return (
      Math.max(box.width, measure.scrollWidth) <= width + 0.1 &&
      Math.max(box.height, measure.scrollHeight) <= height + 0.1
    );
  };
  const floor = minDim < 45 ? 5 : 8;
  const upper = Math.min(1000, Math.floor((vertical ? width : height) / LINE_HEIGHT));
  let low = Math.max(floor, Math.ceil(style.minFontSize)),
    high = Math.min(upper, style.fontSize ? Math.floor(style.fontSize) : upper);
  if (high < low || !fits(low)) return null;
  let size = low;
  for (let step = 0; step < SEARCH_STEPS && low <= high; step++) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      size = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  fits(size);
  const box = measure.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "text";
  addText(el);
  Object.assign(el.style, {
    fontWeight: String(weight),
    fontSize: `${size}px`,
    lineHeight: `${size * LINE_HEIGHT}px`,
    writingMode: c.direction,
    textAlign: style.align,
    textWrap,
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${(c.width - box.width) / 2}px`,
    top: `${style.align === "start" ? (c.height - height) / 2 : (c.height - box.height) / 2}px`,
    color: style.color,
    webkitTextStroke: `${style.strokeWidth}px ${style.stroke}`,
    paintOrder: "stroke fill",
  });
  return { size, html: el.outerHTML };
};
/** 分块只移动同一布局，避免每块重新断行产生接缝。 */
window.imageRender = async (html, x, y) => {
  stage.innerHTML = html;
  Object.assign(stage.style, {
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    left: `${-x}px`,
    top: `${-y}px`,
    transform: `rotate(${frame.rotation}deg)`,
  });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
