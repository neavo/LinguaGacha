import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ProjectPreviewResponse } from "@shared/project-preview";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import { useProjectPreview } from "./use-project-preview";

const api = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: api }));
it("切换路径后旧请求不能覆盖新预览，关闭后中止并重新读取", async () => {
  const first = Promise.withResolvers<ProjectPreviewResponse>();
  const second = Promise.withResolvers<ProjectPreviewResponse>();
  const retry = Promise.withResolvers<ProjectPreviewResponse>();
  api
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(retry.promise);
  let state!: ReturnType<typeof useProjectPreview>;
  /** 重渲染同一实例以验证旧路径回包的隔离。 */
  function Probe({ path }: { path: string | null }) {
    state = useProjectPreview(path);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const preview = {
    file_paths: ["new.txt"],
    created_at: "",
    updated_at: "",
    translation_stats: build_project_translation_stats([]),
  };
  try {
    await act(async () => root.render(<Probe path="first.lg" />));
    await act(async () => root.render(<Probe path="second.lg" />));
    await act(async () => second.resolve({ preview }));
    await act(async () => first.resolve({ preview: { ...preview, file_paths: ["old.txt"] } }));
    expect(state).toEqual({ status: "ready", preview });
    expect(api.mock.calls[0]![2].aborted).toBe(true);
    await act(async () => root.render(<Probe path={null} />));
    expect(state.status).toBe("idle");
    await act(async () => root.render(<Probe path="second.lg" />));
    expect(state.status).toBe("loading");
    expect(api).toHaveBeenCalledTimes(3);
    await act(async () => retry.reject(new Error("preview unavailable")));
    expect(state).toEqual({ status: "failed" });
  } finally {
    await act(async () => root.unmount());
  }
  expect(api.mock.calls[2]![2].aborted).toBe(true);
});
