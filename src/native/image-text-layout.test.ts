import { expect, it } from "vitest";
import { IMAGE_TEXT_RULES as RULES, type ImageTextPage } from "../shared/image-text";
import { image_text_slot_sets } from "./image-text-layout";

function fixture(width: number, height: number) {
  const block: ImageTextPage["regions"][number]["candidates"][number]["blocks"][number] = {
    blockId: "B1",
    box: [0, 0, width, height],
    distance: "",
    preferredFontSize: 10,
    sourceEnvelopeArea: 100,
    sourceCenter: [width / 2, height / 2],
  };
  const distance = Float32Array.from({ length: width * height }, (_, index) =>
    Math.min(
      (index % width) + 1,
      Math.floor(index / width) + 1,
      width - (index % width),
      height - Math.floor(index / width),
    ),
  );
  return { block, distance };
}

it("逐行槽位完整位于距离场安全区，并按源文字中心排列", () => {
  const { block, distance } = fixture(70, 100);
  const size = 10;
  const sets = image_text_slot_sets(block, "horizontal-tb", distance, size);
  expect(sets.length).toBeGreaterThan(1);
  for (const slots of sets)
    for (const slot of slots) {
      expect(slot.inlineHigh - slot.inlineLow).toBeGreaterThanOrEqual(size);
      for (let y = slot.blockStart; y < slot.blockStart + slot.blockSize; y++)
        for (let x = slot.inlineLow; x < slot.inlineHigh; x++)
          expect(distance[y * 70 + x]! - RULES.squareDistanceCorrection).toBeGreaterThanOrEqual(
            Math.max(RULES.minimumStroke, size * RULES.strokeRatio) / 2 +
              RULES.antialiasingAllowance,
          );
    }
  const rotated = fixture(100, 70);
  expect(image_text_slot_sets(rotated.block, "vertical-rl", rotated.distance, size)).toEqual(sets);
});

it("孔洞或过窄区域不会生成跨越无效像素的槽位", () => {
  const { block, distance } = fixture(30, 30);
  for (let y = 0; y < 30; y++) distance[y * 30 + 15] = 0;
  expect(image_text_slot_sets(block, "horizontal-tb", distance, 10)).toEqual([]);
  distance.fill(0);
  expect(image_text_slot_sets(block, "horizontal-tb", distance, 2)).toEqual([]);
});
