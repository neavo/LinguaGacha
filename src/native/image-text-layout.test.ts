import { expect, it } from "vitest";
import {
  IMAGE_TEXT_RULES as RULES,
  image_text_stroke_width,
  type ImageTextRegion,
} from "../shared/image-text";
import { image_text_slots } from "./image-text-layout";

function fixture(width: number, height: number, vertical = false) {
  const region: ImageTextRegion = {
    regionId: "r",
    box: [0, 0, width, height],
    distance: "",
    sourceLines: [],
    kind: "bubble",
    direction: vertical ? "vertical-rl" : "horizontal-tb",
    text: "译文",
    backgroundColor: [255, 255, 255],
  };
  const distance = Float32Array.from({ length: width * height }, (_, index) =>
    Math.min(
      (index % width) + 1,
      Math.floor(index / width) + 1,
      width - (index % width),
      height - Math.floor(index / width),
    ),
  );
  return { region, distance };
}

it("横竖排共用以气泡主体为中心的安全行带", () => {
  const { region, distance } = fixture(70, 100);
  const size = 25;
  const margin = image_text_stroke_width(size) / 2 + RULES.antialiasingAllowance;
  const stacks = [...image_text_slots(region, distance).bubble(size, false, 3)];
  expect(stacks).toHaveLength(3);
  let closest = Infinity;
  for (const slots of stacks)
    for (const slot of slots) {
      expect(slot.anchor).toBeCloseTo(35);
      for (let y = slot.blockStart; y < slot.blockStart + size; y++)
        for (let x = slot.inlineLow; x < slot.inlineHigh; x++)
          closest = Math.min(closest, distance[y * 70 + x]! - RULES.squareDistanceCorrection);
    }
  expect(closest).toBeGreaterThanOrEqual(margin);
  const rotated = fixture(100, 70, true);
  expect([...image_text_slots(rotated.region, rotated.distance).bubble(size, false, 3)]).toEqual(
    stacks,
  );
});

it("无框文字沿原行带排版，跨过行间的掩码空白", () => {
  const { region, distance } = fixture(70, 100);
  region.kind = "unframed";
  region.sourceLines = [
    [
      [8, 13],
      [58, 13],
      [58, 23],
      [8, 23],
    ],
    [
      [8, 65],
      [58, 65],
      [58, 75],
      [8, 75],
    ],
  ];
  distance.fill(0, 30 * 70, 60 * 70);
  const rows = image_text_slots(region, distance).unframed(10);
  expect(rows.map((slot) => slot?.blockStart)).toEqual([13, 65]);
});

it("文字凸包占比只计入掩码内的面积", () => {
  const { region, distance } = fixture(10, 10);
  for (let row = 0; row < 10; row++) distance.fill(0, row * 10 + 3, row * 10 + 7);

  const slots = image_text_slots(region, distance);
  expect(
    slots.coverage([
      { along: [1, 3], across: [2, 8] },
      { along: [7, 9], across: [2, 8] },
    ]),
  ).toBeCloseTo(0.4);
});
