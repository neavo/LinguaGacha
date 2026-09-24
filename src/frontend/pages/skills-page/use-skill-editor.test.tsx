const runtime_state = vi.hoisted(() => ({ owner: null as "agent" | null }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => runtime_state,
}));
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSkillFile, AgentSkillIdentity } from "@shared/agent-skills";
import { useSkillEditor, SKILL_AUTOSAVE_DELAY_MS } from "./use-skill-editor";
import { format_skill_editor_document, read_skill_editor_document } from "./skill-editor-document";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), t: (key: string) => key }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
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
    mocks.toast.mockReset();
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
  it("删除命令先保留待丢弃草稿，失败后恢复自动保存", async () => {
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
    expect(saves()).toHaveLength(1);
    expect(editor.error).toBe("");
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
    expect(editor.error).toBe("");
    expect(mocks.toast).toHaveBeenCalledWith("error", "skills_page.feedback.operation_failed");
  });
  it("重名使用通知，保存错误状态独立且允许继续自动保存", async () => {
    const previous = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (url, body) => {
      if (url.endsWith("/change")) throw new DesktopApiError({ code: "file.already_exists" });
      return previous(url, body);
    });
    await act(async () => {
      expect(await editor.change_file({ operation: "create_file", path: "note.md" })).toBe(false);
    });
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "error",
      "skills_page.feedback.duplicate_name",
    );
    expect(editor.error).toBe("");
    await edit("continue");
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    expect(disk.document?.body).toBe("continue");
  });
  it("文件命令前保存失败保留草稿并提示通知", async () => {
    save = async () => {
      throw new Error("disk full");
    };
    await edit("keep me");
    await act(async () => {
      expect(await editor.change_file({ operation: "create_file", path: "note.md" })).toBe(false);
    });
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/change"))).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith("error", editor.error);
    expect(editor.dirty).toBe(true);
  });
  it("放弃修改并重新加载后清除保存错误和冲突状态", async () => {
    save = async () => {
      throw new DesktopApiError({ code: "data.revision_conflict" });
    };
    await edit("unsaved");
    await act(async () => {
      expect(await editor.flush()).toBe(false);
    });
    expect(editor.conflict).toBe(true);
    await act(async () => {
      expect(await editor.recover()).toBe(true);
    });
    expect(editor.error).toBe("");
    expect(editor.conflict).toBe(false);
    expect(editor.dirty).toBe(false);
    expect(read_skill_editor_document(editor.draft).body).toBe("original");
  });
  it("目录移动成功同步当前文件路径并复用保存版本", async () => {
    await act(async () => {
      await editor.open_file("references/note.md");
    });
    const previous_file = editor.file!;
    mocks.api.mockClear();
    await act(async () => {
      expect(
        await editor.change_file({
          operation: "move",
          path: "references",
          destination: "archive/references",
        }),
      ).toBe(true);
    });
    expect(editor.file).toEqual({ ...previous_file, path: "archive/references/note.md" });
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/read"))).toBe(false);
    expect(editor.dirty).toBe(false);
  });
  it("创建成功后的读取失败保留新文件树，命令仍报告成功", async () => {
    const previous = mocks.api.getMockImplementation()!;
    const entries = [
      { path: "SKILL.md", kind: "file" },
      { path: "new.md", kind: "file" },
    ];
    mocks.api.mockImplementation(async (url, body) => {
      if (url.endsWith("/change")) return { skill: identity, entries };
      if (url.endsWith("/read")) throw new Error("read failed");
      return previous(url, body);
    });
    await act(async () => {
      expect(await editor.change_file({ operation: "create_file", path: "new.md" })).toBe(true);
    });
    expect(editor.tree?.entries).toEqual(entries);
    expect(editor.file).toBeNull();
    expect(editor.error).toBe("skills_page.feedback.load_failed");
  });
});
