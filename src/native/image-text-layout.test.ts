import { expect, it } from "vitest";
import { IMAGE_TEXT_RULES as RULES, type ImageTextPage } from "../shared/image-text";
import { image_text_rectangles } from "./image-text-layout";

function fixture(width: number, height: number, vertical = false) {
  const region: ImageTextPage["regions"][number] = {
    regionId: "r",
    blockId: "B1",
    text: "测试",
    direction: vertical ? "vertical-rl" : "horizontal-tb",
    fill: { color: [255, 255, 255] },
    box: [0, 0, width, height],
    distance: "",
    centroid: [width / 2, height / 2],
  };
  const distance = Float32Array.from({ length: width * height }, (_, i) =>
    Math.min(
      (i % width) + 1,
      Math.floor(i / width) + 1,
      width - (i % width),
      height - Math.floor(i / width),
    ),
  );
  return { region, distance };
}

it("候选容纳测量宽度，并完整位于带描边余量的安全矩形内", () => {
  const { region, distance } = fixture(70, 100);
  const size = 10;
  const rectangles = image_text_rectangles(region, distance, size, [Infinity, 200, 110]);
  expect(rectangles.length).toBeGreaterThan(0);
  for (const r of rectangles) {
    expect(r.inlineSize).toBeGreaterThanOrEqual(
      ([Infinity, 200, 110][r.lines]! * size) / RULES.measurementFontSize,
    );
    expect(r.blockSize).toBeGreaterThanOrEqual(r.lines * size * RULES.lineHeight);
    expect(Math.abs(r.blockStart + r.blockSize / 2 - region.centroid[1])).toBeLessThanOrEqual(0.5);
    for (let y = r.blockStart; y < r.blockStart + r.blockSize; y++)
      for (let x = r.inlineStart; x < r.inlineStart + r.inlineSize; x++)
        expect(distance[y * 70 + x]! - RULES.squareDistanceCorrection).toBeGreaterThanOrEqual(
          size * RULES.marginRatio + Math.max(RULES.minimumStroke, size * RULES.strokeRatio) / 2,
        );
  }
  const rotated = fixture(100, 70, true);
  expect(
    image_text_rectangles(rotated.region, rotated.distance, size, [Infinity, 200, 110]),
  ).toEqual(rectangles);
});

it("中央孔洞和不可用掩码不会被矩形跨越，测量不足也不生成候选", () => {
  const { region, distance } = fixture(30, 30);
  expect(image_text_rectangles(region, distance, 10, [Infinity, Infinity])).toEqual([]);
  for (let y = 0; y < 30; y++) distance[y * 30 + 15] = 0;
  expect(image_text_rectangles(region, distance, 10, [Infinity, 50])).toEqual([]);
  distance.fill(0);
  expect(image_text_rectangles(region, distance, 2, [Infinity, 10])).toEqual([]);
});
