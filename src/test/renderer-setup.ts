import { afterEach } from "vitest";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  BASE_UI_ANIMATIONS_DISABLED: true, // 无布局环境关闭 Base UI 的动画等待，业务动画由对应测试驱动完成信号。
});

// jsdom 不执行布局，需要尺寸、滚动位置或绘图的测试自行提供场景数据。
Range.prototype.getBoundingClientRect = () => new DOMRect();
Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
HTMLElement.prototype.scrollIntoView = () => {};
Element.prototype.getAnimations = () => [];
HTMLCanvasElement.prototype.getContext = () => null;
/** 默认观察器不持有订阅，尺寸通知由对应测试的观察器夹具推进。 */
globalThis.ResizeObserver = class implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

/** jsdom 未实现 DragEvent，复用 MouseEvent 的传播语义。 */
globalThis.DragEvent = class extends MouseEvent implements DragEvent {
  readonly dataTransfer: DataTransfer | null = null; // 文件载荷由场景测试写入。
};

window.matchMedia = (media) => {
  const target = new EventTarget();
  return Object.assign(target, {
    media,
    matches: false, // 默认媒体条件不匹配，动态条件由消费方测试显式驱动。
    onchange: null,
    addListener: (listener: ((event: MediaQueryListEvent) => void) | null) =>
      target.addEventListener("change", listener as EventListener | null),
    removeListener: (listener: ((event: MediaQueryListEvent) => void) | null) =>
      target.removeEventListener("change", listener as EventListener | null),
  });
};

// 动画和剪贴板效果必须由对应测试提供，避免未建模的调用静默成功。
Element.prototype.animate = () => {
  throw new Error("Animation tests must provide completion and cancellation signals.");
};
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async () => {
      throw new Error("Clipboard tests must provide the write result.");
    },
  },
});

afterEach(() => {
  document.body.innerHTML = "";
});
