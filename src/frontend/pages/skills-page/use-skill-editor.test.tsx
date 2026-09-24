const runtime_state = vi.hoisted(() => ({ owner: null as "agent" | null }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => runtime_state,
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSkillFile, AgentSkillIdentity } from "@shared/agent-skills";
import { useSkillEditor, SKILL_AUTOSAVE_DELAY_MS } from "./use-skill-editor";
import { format_skill_editor_document, read_skill_editor_document } from "./skill-editor-document";

const mocks = vi.hoisted(() => ({ api: vi.fn(), t: (key: string) => key }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: mocks.t }) }));

describe("技能自动保存", () => {
  let root: Root;
  let container: HTMLDivElement;
  let editor: ReturnType<typeof useSkillEditor>;
  const identity: AgentSkillIdentity = { source: "user", name: "sample" };
  let disk: AgentSkillFile;
  let save: ((body: Record<string, unknown>) => Promise<void>) | undefined;
  /** 通过组件挂载观察 Hook 的公开状态。 */
  function Harness() {
    editor = useSkillEditor(identity);
    return null;
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    runtime_state.owner = null;
    mocks.api.mockReset();
    save = undefined;
    disk = {
      skill: identity,
      path: "SKILL.md",
      text: "original",
      size: 8,
      revision: "1",
      document: { name: "sample", description: "description", body: "original" },
    };
    mocks.api.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url.endsWith("/tree"))
        return { skill: identity, entries: [{ path: "SKILL.md", kind: "file" }] };
      if (url.endsWith("/read"))
        return body.path === "SKILL.md"
          ? structuredClone(disk)
          : { skill: disk.skill, path: body.path, text: "reference", size: 9, revision: "1" };
      if (url.endsWith("/save")) {
        await save?.(body);
        disk = {
          ...disk,
          document: body.document as AgentSkillFile["document"],
          text: String(body.text),
          revision: String(Number(disk.revision) + 1),
        };
        return structuredClone(disk);
      }
      if (url.endsWith("/change"))
        return { skill: identity, entries: [{ path: "SKILL.md", kind: "file" }] };
      throw new Error("Unexpected API route");
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  /** 将输入送入公开编辑入口。 */
  async function edit(body: string) {
    await act(async () =>
      editor.edit(
        format_skill_editor_document({ ...read_skill_editor_document(editor.draft), body }),
      ),
    );
  }
  /** 保存请求的顺序是自动保存协议的一部分。 */
  const saves = () => mocks.api.mock.calls.filter(([url]) => url.endsWith("/save"));

  it("运行占用暂停已排队自动保存，保留草稿并在空闲后恢复", async () => {
    const draft = format_skill_editor_document({ ...disk.document!, body: "updated" });
    await act(async () => editor.edit(draft));
    runtime_state.owner = "agent";
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS * 2));
    expect(saves()).toHaveLength(0);
    expect(editor.draft).toBe(draft);
    expect(editor.locked).toBe(true);
    await act(async () => {
      expect(await editor.flush()).toBe(false);
    });
    await act(async () => {
      expect(await editor.change_file({ operation: "create_file", path: "new.md" })).toBe(false);
    });
    runtime_state.owner = null;
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS));
    expect(disk.document?.body).toBe("updated");
    expect(editor.dirty).toBe(false);
  });

  it("合并输入，输入法组词期间暂停，完成后保存最新正文", async () => {
    await edit("first");
    await edit("latest");
    await act(async () => editor.compose(true));
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS * 2));
    expect(saves()).toHaveLength(0);
    await act(async () => editor.compose(false));
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    expect(saves()).toHaveLength(1);
    expect(disk.document?.body).toBe("latest");
    expect(editor.dirty).toBe(false);
  });
  it("保存期间继续输入按顺序提交，切换等待最新保存", async () => {
    let release!: () => void;
    save = async () => {
      save = undefined;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    await edit("first");
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    await edit("second");
    let switched!: Promise<boolean>;
    await act(async () => {
      switched = editor.open_file("reference.md");
    });
    expect(
      mocks.api.mock.calls.some(
        ([url, body]) => url.endsWith("/read") && body.path === "reference.md",
      ),
    ).toBe(false);
    await act(async () => {
      release();
      await switched;
    });
    expect(saves().map(([, body]) => body.document.body)).toEqual(["first", "second"]);
    expect(editor.file?.path).toBe("reference.md");
  });
  it("保存失败保留草稿并阻止切换，重试成功后继续", async () => {
    save = async () => {
      throw new Error("disk full");
    };
    await edit("keep me");
    await act(async () => {
      expect(await editor.open_file("reference.md")).toBe(false);
    });
    expect(editor.file?.path).toBe("SKILL.md");
    expect(read_skill_editor_document(editor.draft).body).toBe("keep me");
    expect(editor.error).not.toBe("");
    save = undefined;
    await act(async () => {
      expect(await editor.flush()).toBe(true);
    });
    expect(disk.document?.body).toBe("keep me");
    expect(editor.dirty).toBe(false);
  });
  it("元数据无效时整份主文件不保存，修正后正文和字段一起提交", async () => {
    await act(async () =>
      editor.edit(format_skill_editor_document({ name: "", description: "new", body: "changed" })),
    );
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    expect(editor.invalid).toBe("name");
    expect(saves()).toHaveLength(0);
    await act(async () =>
      editor.edit(
        format_skill_editor_document({
          ...read_skill_editor_document(editor.draft),
          name: "sample",
        }),
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    expect(disk.document).toEqual({ name: "sample", description: "new", body: "changed" });
  });
  it("删除确认后的目标草稿不再保存，删除失败仍保留草稿", async () => {
    await act(async () => {
      await editor.open_file("note.md");
    });
    await act(async () => editor.edit("unsaved"));
    const previous = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (url, body) => {
      if (url.endsWith("/change")) throw new Error("denied");
      return previous(url, body);
    });
    await act(async () => {
      expect(await editor.change_file({ operation: "delete", path: "note.md" })).toBe(false);
    });
    expect(editor.draft).toBe("unsaved");
    expect(saves()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS * 2));
    expect(saves()).toHaveLength(0);
  });
  it("离页等待在途文件操作，文件操作失败时仍留在当前页", async () => {
    const previous = mocks.api.getMockImplementation()!;
    let reject!: (reason: Error) => void;
    mocks.api.mockImplementation(async (url, body) => {
      if (url.endsWith("/change"))
        await new Promise<void>((_, reject_request) => {
          reject = reject_request;
        });
      return previous(url, body);
    });
    let changed!: Promise<boolean>;
    await act(async () => {
      changed = editor.change_file({ operation: "create_file", path: "new.md" });
    });
    let completed = false;
    let leaving!: Promise<boolean>;
    await act(async () => {
      leaving = editor.flush().then((result) => {
        completed = true;
        return result;
      });
    });
    expect(completed).toBe(false);
    await act(async () => {
      reject(new Error("disk full"));
      expect(await changed).toBe(false);
      expect(await leaving).toBe(false);
    });
    expect(editor.error).not.toBe("");
  });
});
