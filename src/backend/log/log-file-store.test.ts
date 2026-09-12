import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { LogFileStore } from "./log-file-store";
import type { LogFileRecord } from "../../shared/log";

const DATE = "20260913";
/** 生成最小正文，测试只覆盖目标场景所需字段。 */
function record(text: string, window = true): LogFileRecord {
  return {
    created_at: "2026-09-13T08:00:00.000Z",
    level: "info",
    source: "test",
    content: { kind: "text", text },
    ...(window ? {} : { window: false as const }),
  };
}

describe("LogFileStore", () => {
  it("另一日期编辑不影响当前游标，拒绝跨日期游标", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-one-date-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("当前日期"));
    store.append("20260914", record("下一日期"));
    const current = await store.read_page({ date: DATE, direction: "latest" });
    fs.writeFileSync(
      path.join(dir.path, "app.20260914.jsonl"),
      JSON.stringify(record("外部编辑")) + "\n",
    );
    const unchanged = await store.read_page({
      date: DATE,
      direction: "after",
      cursor: current.after!,
    });
    expect(unchanged.status).toBe("ready");
    expect(unchanged.entries).toEqual([]);
    expect(unchanged.after).toEqual(current.after);
    await expect(
      store.read_page({ date: "20260914", direction: "after", cursor: current.after! }),
    ).rejects.toThrow();
    await store.close();
  });
  it("外部改单行后行号身份保持，旧游标与详情失效，随后自身追加不会掩盖编辑", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-edit-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("alpha"));
    store.append(DATE, record("第二行"));
    const before = await store.read_page({ date: DATE, direction: "latest" });
    const body = path.join(dir.path, `app.${DATE}.jsonl`);
    fs.writeFileSync(body, fs.readFileSync(body, "utf8").replace("alpha", "更长的内容🙂"));
    store.append(DATE, record("新增"));
    expect(
      (await store.read_page({ date: DATE, direction: "after", cursor: before.after! })).status,
    ).toBe("cursor_invalid");
    expect(await store.read_detail(before.entries[1]!.id, before.entries[1]!.revision)).toBeNull();
    const after = await store.read_page({ date: DATE, direction: "latest" });
    expect(after.entries.map((entry) => entry.id)).toEqual([`${DATE}:1`, `${DATE}:2`, `${DATE}:3`]);
    expect(after.entries.map((entry) => entry.message_preview)).toEqual([
      "更长的内容🙂",
      "第二行",
      "新增",
    ]);
    expect(await store.read_detail(after.entries[1]!.id, after.entries[1]!.revision)).toMatchObject(
      { content: { text: "第二行" } },
    );
    await store.close();
  });

  it("等字节替换和跨重启编辑都重建摘要，不根据文件长度猜测为追加", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-replace-"));
    const body = path.join(dir.path, `app.${DATE}.jsonl`);
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("alpha"));
    const before = await store.read_page({ date: DATE, direction: "latest" });
    const bytes = fs.statSync(body).size;
    fs.writeFileSync(body, fs.readFileSync(body, "utf8").replace("alpha", "bravo"));
    const after = await store.read_page({ date: DATE, direction: "latest" });
    expect(fs.statSync(body).size).toBe(bytes);
    expect(after.entries[0]?.message_preview).toBe("bravo");
    expect(after.after?.revision).not.toBe(before.after?.revision);
    await store.close();
    fs.writeFileSync(body, fs.readFileSync(body, "utf8").replace("bravo", "delta"));
    const reopened = new LogFileStore(dir.path, new NativeFs());
    const page = await reopened.read_page({ date: DATE, direction: "latest" });
    expect(page.entries[0]?.message_preview).toBe("delta");
    expect(page.entries[0]?.id).toBe(before.entries[0]?.id);
    expect(
      await reopened.read_detail(before.entries[0]!.id, before.entries[0]!.revision),
    ).toBeNull();
    await reopened.close();
  });

  it("隐藏行、损坏行均计数，插删物理行使旧内容代次失效", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-line-number-"));
    const body = path.join(dir.path, `app.${DATE}.jsonl`);
    fs.writeFileSync(
      body,
      [JSON.stringify(record("隐藏", false)), "broken", JSON.stringify(record("可见")), ""].join(
        "\n",
      ),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const store = new LogFileStore(dir.path, new NativeFs());
      const before = await store.read_page({ date: DATE, direction: "latest" });
      expect(before.entries[0]?.line).toBe(3);
      fs.writeFileSync(body, JSON.stringify(record("插入")) + "\n" + fs.readFileSync(body, "utf8"));
      const inserted = await store.read_page({ date: DATE, direction: "latest" });
      expect(inserted.entries.map((entry) => entry.line)).toEqual([1, 4]);
      expect(
        await store.read_detail(before.entries[0]!.id, before.entries[0]!.revision),
      ).toBeNull();
      fs.writeFileSync(body, JSON.stringify(record("删除后")) + "\n");
      expect(
        (await store.read_page({ date: DATE, direction: "check", cursor: inserted.after! })).status,
      ).toBe("cursor_invalid");
      await store.close();
    } finally {
      stderr.mockRestore();
    }
  });

  it("重建读取期间被编辑时重新扫描，返回完整一致的新内容", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-edit-during-read-"));
    const body = path.join(dir.path, `app.${DATE}.jsonl`);
    fs.writeFileSync(body, JSON.stringify(record("alpha")) + "\n");
    const native = new NativeFs();
    const read = native.read_range.bind(native);
    let edited = false;
    vi.spyOn(native, "read_range").mockImplementation(async (file, start, length) => {
      const bytes = await read(file, start, length);
      if (file === body && !edited) {
        edited = true;
        fs.writeFileSync(body, fs.readFileSync(body, "utf8").replace("alpha", "bravo"));
      }
      return bytes;
    });
    const store = new LogFileStore(dir.path, native);
    expect(
      (await store.read_page({ date: DATE, direction: "latest" })).entries[0]?.message_preview,
    ).toBe("bravo");
    await store.close();
  });
  it("跨多个索引读取块分页时保留每条记录和正确游标", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-chunks-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    for (let index = 0; index < 240; index++)
      store.append(DATE, record(`${String(index)}:${"内容".repeat(600)}`));
    let page = await store.read_page({ date: DATE, direction: "latest" });
    const entries = [...page.entries];
    while (page.has_more) {
      page = await store.read_page({ date: DATE, direction: "before", cursor: page.before! });
      entries.unshift(...page.entries);
    }
    expect(entries).toHaveLength(240);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(240);
    expect(entries[0]?.message_preview).toMatch(/^0:/);
    expect(entries.at(-1)?.message_preview).toMatch(/^239:/);
    await store.close();
  });
  it("中文多行正文跨重启读取，索引只保存摘要与隐藏进度", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-store-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("中文\n🙂".repeat(20000)));
    store.append(DATE, record("隐藏正文", false));
    await store.close();
    const reopened = new LogFileStore(dir.path, new NativeFs());
    const page = await reopened.read_page({ date: DATE, direction: "latest" });
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0]!;
    expect(entry.message_preview.length).toBeLessThan(entry.message_length);
    expect(await reopened.read_detail(entry.id, entry.revision)).toMatchObject({
      content: record("中文\n🙂".repeat(20000)).content,
    });
    expect(await reopened.read_detail(`${DATE}:2`, entry.revision)).toBeNull();
    const lines = fs
      .readFileSync(path.join(dir.path, `app.${DATE}.idx.jsonl`), "utf8")
      .trim()
      .split("\n");
    expect(JSON.parse(lines[1]!)).toEqual({
      line: 2,
      end: fs.statSync(path.join(dir.path, `app.${DATE}.jsonl`)).size,
    });
    expect(fs.readFileSync(path.join(dir.path, `app.${DATE}.jsonl`), "utf8")).not.toContain(
      '"version"',
    );
    await reopened.close();
  });

  it("历史分页和增量读取只访问选中日期", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-pages-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    for (let index = 0; index < 8; index++) store.append(DATE, record(String(index)));
    const latest = await store.read_page({ date: DATE, direction: "latest", limit: 3 });
    expect(latest.entries.map((entry) => entry.message_preview)).toEqual(["5", "6", "7"]);
    const older = await store.read_page({
      date: DATE,
      direction: "before",
      cursor: latest.before!,
      limit: 3,
    });
    expect(older.entries.map((entry) => entry.message_preview)).toEqual(["2", "3", "4"]);
    const oldest = await store.read_page({
      date: DATE,
      direction: "before",
      cursor: older.before!,
      limit: 3,
    });
    expect(oldest.entries.map((entry) => entry.message_preview)).toEqual(["0", "1"]);
    expect(oldest.has_more).toBe(false);
    store.append(DATE, record("8"));
    store.append("20260914", record("9"));
    const next = await store.read_page({ date: DATE, direction: "after", cursor: latest.after! });
    expect(next.entries.map((entry) => entry.message_preview)).toEqual(["8"]);
    expect(
      (await store.read_page({ date: DATE, direction: "after", cursor: next.after! })).entries,
    ).toEqual([]);
    await store.close();
  });

  it("缺失、落后和不完整索引从正文恢复，保留详情身份", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-repair-"));
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("一"));
    const first = await store.read_page({ date: DATE, direction: "latest" });
    const index = path.join(dir.path, `app.${DATE}.idx.jsonl`);
    fs.appendFileSync(index, '{"end":');
    fs.appendFileSync(
      path.join(dir.path, `app.${DATE}.jsonl`),
      JSON.stringify(record("二")) + "\n",
    );
    const recovered = await store.read_page({ date: DATE, direction: "latest" });
    expect(recovered.entries.map((entry) => entry.message_preview)).toEqual(["一", "二"]);
    expect(recovered.entries[0]?.id).toBe(first.entries[0]?.id);
    fs.unlinkSync(index);
    expect(
      (await store.read_page({ date: DATE, direction: "latest" })).entries.map((entry) => entry.id),
    ).toEqual(recovered.entries.map((entry) => entry.id));
    fs.writeFileSync(index, "broken\n");
    expect(
      (await store.read_page({ date: DATE, direction: "latest" })).entries.map((entry) => entry.id),
    ).toEqual(recovered.entries.map((entry) => entry.id));
    await store.close();
  });

  it("恢复期间继续追加且并发查询共享索引，不产生重复", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-overlap-"));
    const native = new NativeFs();
    const store = new LogFileStore(dir.path, native);
    store.append(DATE, record("起点"));
    fs.unlinkSync(path.join(dir.path, `app.${DATE}.idx.jsonl`));
    const pending = store.read_page({ date: DATE, direction: "latest" });
    store.append(DATE, record("恢复中追加"));
    const [one, two] = await Promise.all([
      pending,
      store.read_page({ date: DATE, direction: "latest" }),
    ]);
    expect(one.entries.map((entry) => entry.message_preview)).toEqual(["起点", "恢复中追加"]);
    expect(two.entries).toEqual(one.entries);
    await store.close();
  });

  it("索引写入失败保留正文，后续查询补回记录", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-failure-"));
    const native = new NativeFs();
    const original = native.append_text_file.bind(native);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const append = vi.spyOn(native, "append_text_file").mockImplementation((file, text) => {
      if (file.endsWith(".idx.jsonl")) throw new Error("index unavailable");
      original(file, text);
    });
    try {
      const store = new LogFileStore(dir.path, native);
      store.append(DATE, record("必须保留"));
      append.mockRestore();
      expect(
        (await store.read_page({ date: DATE, direction: "latest" })).entries[0]?.message_preview,
      ).toBe("必须保留");
      await store.close();
    } finally {
      append.mockRestore();
      stderr.mockRestore();
    }
  });

  it("隔开崩溃尾行，读取只提交完整正文并报告损坏位置", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-tail-"));
    const body = path.join(dir.path, `app.${DATE}.jsonl`);
    fs.writeFileSync(body, JSON.stringify(record("有效")) + '\n{"content":');
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const store = new LogFileStore(dir.path, new NativeFs());
      const incomplete = await store.read_page({ date: DATE, direction: "latest" });
      expect(incomplete.entries).toHaveLength(1);
      // 未完成尾行保持同一索引代次，重复检查不能令已有游标失效。
      expect(
        (await store.read_page({ date: DATE, direction: "check", cursor: incomplete.after! }))
          .status,
      ).toBe("ready");
      store.append(DATE, record("重启后"));
      expect(
        (await store.read_page({ date: DATE, direction: "latest" })).entries.map(
          (entry) => entry.message_preview,
        ),
      ).toEqual(["有效", "重启后"]);
      expect(stderr).toHaveBeenCalled();
      await store.close();
    } finally {
      stderr.mockRestore();
    }
  });

  it("三日期清理涵盖旧日志和索引，越界游标与非法路径明确拒绝", async () => {
    using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-cleanup-"));
    for (const date of ["20260909", "20260910", "20260911", "20260912"]) {
      fs.writeFileSync(path.join(dir.path, `app.${date}.log`), "旧日志");
      fs.writeFileSync(path.join(dir.path, `app.${date}.idx.jsonl`), "");
    }
    const store = new LogFileStore(dir.path, new NativeFs());
    store.append(DATE, record("最新"));
    expect(fs.readdirSync(dir.path).some((name) => name.includes("20260910"))).toBe(false);
    expect(store.list_dates()).toEqual([DATE]);
    expect((await store.read_page({ direction: "latest", date: "20260909" })).status).toBe(
      "expired",
    );
    await expect(store.read_detail("../secret:0", "rev")).rejects.toThrow();
    await expect(store.read_page({ date: DATE, direction: "latest", limit: -1 })).rejects.toThrow();
    expect(
      (
        await store.read_page({
          date: DATE,
          direction: "after",
          cursor: { date: DATE, line: 1, revision: "old" },
        })
      ).status,
    ).toBe("cursor_invalid");
    await store.close();
  });
});
