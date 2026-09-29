import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BatchTranslationWaveform } from "./batch-translation-waveform";
const screen = vi.hoisted(() => ({ ratio: 1 }));
vi.mock("@frontend/widgets/interactions/use-device-pixel-ratio", () => ({
  useDevicePixelRatio: () => screen.ratio,
}));

it("历史不变时 DPR 变化仍重建像素缓冲区并重绘", async () => {
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  const history = [1, 2, 3];
  try {
    await act(async () => root.render(<BatchTranslationWaveform history={history} />));
    const canvas = container.querySelector("canvas")!;
    const original = [canvas.width, canvas.height];
    context.fillText.mockClear();
    screen.ratio = 2;
    await act(async () => root.render(<BatchTranslationWaveform history={history} />));
    expect([canvas.width, canvas.height]).toEqual(original.map((value) => value * 2));
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.fillText).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    screen.ratio = 1;
    vi.restoreAllMocks();
  }
});
