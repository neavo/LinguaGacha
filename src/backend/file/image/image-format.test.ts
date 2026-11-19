import { expect, it } from "vitest";
import { ImageFormat, image_record_identities } from "./image-format";
import { read_image_writeback } from "../../../shared/image-package";
import { image_fixture } from "../../../test/image-fixture";

it("图片译文快照保留原样正文和字号，并区分空正文、排除与未翻译", async () => {
  const fixture = image_fixture(["blank", "excluded", "unfinished", "lettering"]);
  const bytes = await fixture.pack();
  const { items } = await new ImageFormat().read(bytes, "book.image");
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  items[1]!.status = "EXCLUDED";
  items[1]!.dst = "既有译文";
  const text = "  甲  乙\r\n\r\n丙";
  items[3]!.status = "PROCESSED";
  items[3]!.dst = text;
  items[3]!.extra_field = { image: { fontSize: 18 } };
  const writeback: unknown = JSON.parse(
    await new ImageFormat().render_text(bytes, items, "book.image"),
  );
  const textRecords = read_image_writeback(writeback, fixture.records);
  expect(textRecords).toMatchObject([
    { output: "translated", text: "" },
    { output: "original" },
    { output: null },
    { output: "translated", text, fontSize: 18 },
  ]);
});

it("重新准备仅改变包号和页号时保留原稿身份", () => {
  const fixture = image_fixture();
  const recreated = structuredClone(fixture.book);
  recreated.bookId = "recreated";
  recreated.pages[0]!.pageId = "recreated-page";
  const records = structuredClone(fixture.records);
  records[0]!.pageId = "recreated-page";
  expect(image_record_identities(recreated, records)).toEqual(
    image_record_identities(fixture.book, fixture.records),
  );
});
