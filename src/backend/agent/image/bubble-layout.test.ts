import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { AGENT_WORKSPACE_CHANGE_PATHS, AGENT_WORKSPACE_PATHS } from "../workspace/paths";
import { queue_image_bubble_layout } from "./bubble-layout";

it("从子格定位整泡并保留已登记的条目意图", () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-bubble-layout-"));
  const workspace = directory.path;
  // 快照与条目变更采用真实的 JSONL 文件。
  const write = (file: string, data: string) => {
    const target = path.join(workspace, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };
  const { book, records } = image_fixture(["page"]);
  const page = book.pages[0]!;
  const first = page.regions[0]!;
  page.regions.push(
    { ...first, regionId: "second", patch: null },
    { ...first, regionId: "whole", parts: [first.regionId, "second"], patch: null },
  );
  records.push(
    { pageId: page.pageId, regionId: "second", message: "乙" },
    { pageId: page.pageId, regionId: "whole", message: "甲乙" },
  );
  write("sources/book.image/image.json", JSON.stringify(book));
  write("sources/book.image/items.json", JSON.stringify(records));
  write(
    AGENT_WORKSPACE_PATHS.items,
    records
      .map(({ message }, row_number) =>
        JSON.stringify({
          item_id: row_number + 1,
          fp: "000" + row_number,
          row_number,
          file_path: "book.image",
          src: message,
          name_src: "",
          dst: "",
          name_dst: "",
          status: "NONE",
        }),
      )
      .join("\n"),
  );
  const updates = AGENT_WORKSPACE_CHANGE_PATHS.items.updates;
  const prior = { item_id: 7, fp: "abc7", dst: "既有修正" };
  write(updates, JSON.stringify(prior)); // 合法的变更清单可以省略末行换行符。
  expect(
    queue_image_bubble_layout(
      workspace,
      { assetPath: "book.image", pageId: "page", regionId: "second" },
      "whole",
    ),
  ).toEqual({ status: "queued", itemIds: [3] });
  const rows = fs.readFileSync(path.join(workspace, updates), "utf8").trim().split("\n");
  expect(rows.map((line) => JSON.parse(line))).toEqual([
    prior,
    { item_id: 1, fp: "0000", bubble_active: false },
    { item_id: 2, fp: "0001", bubble_active: false },
    { item_id: 3, fp: "0002", bubble_active: true },
  ]);
});
