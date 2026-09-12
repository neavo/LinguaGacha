import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LogManager } from "./log-manager";
import type { LogContent } from "../../shared/log";

describe("LogManager", () => {
  it("统一正文文件、索引摘要和控制台文本，调用方修改不会影响已写记录", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-manager-"));
    const console_lines: string[] = [];
    const manager = new LogManager({
      logDir: directory.path,
      consoleWriter: (text) => console_lines.push(text),
    });
    const content: LogContent = {
      kind: "translation_result",
      summary: ["任务完成"],
      sections: [],
      pairs: [{ src: "原文", dst: "译文" }],
    };
    manager.append({ level: "info", content, source: "engine" });
    content.pairs[0]!.dst = "污染";
    const page = await manager.files.read_page({
      date: manager.files.list_dates()[0]!,
      direction: "latest",
    });
    expect(page.entries[0]?.message_preview).toContain("译文");
    const detail = await manager.files.read_detail(page.entries[0]!.id, page.entries[0]!.revision);
    expect(detail?.content).toMatchObject({ pairs: [{ dst: "译文" }] });
    expect(console_lines[0]).toContain("译文");
    await manager.shutdown();
  });

  it("窗口关闭记录仍落盘，错误诊断保留，shutdown 后停止追加", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-manager-"));
    const manager = new LogManager({
      logDir: directory.path,
      targets: { console: false, window: false },
    });
    manager.fatal("失败", { error: new Error("boom") });
    expect(
      (await manager.files.read_page({ date: manager.files.list_dates()[0]!, direction: "latest" }))
        .entries,
    ).toEqual([]);
    await manager.shutdown();
    const file = path.join(directory.path, `app.${manager.files.list_dates()[0]!}.jsonl`);
    const before = fs.readFileSync(file, "utf8");
    expect(JSON.parse(before)).toMatchObject({
      level: "fatal",
      window: false,
      error: { message: "boom" },
    });
    manager.info("关闭后");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
