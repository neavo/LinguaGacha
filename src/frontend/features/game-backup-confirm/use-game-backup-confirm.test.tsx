import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGameBackupConfirm } from "./use-game-backup-confirm";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let state: ReturnType<typeof useGameBackupConfirm>;
let root: Root | null;
let container: HTMLDivElement;

/** 通过 Hook 的公开弹窗属性观察确认生命周期。 */
function Probe() {
  state = useGameBackupConfirm();
  return null;
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

it("不含游戏时直接通过，不打开提示", async () => {
  await act(async () => {
    expect(await state.request_confirm(false)).toBe(true);
  });
  expect(state.dialog_props.open).toBe(false);
});

it("含游戏时等待确认或取消，卸载按取消结束", async () => {
  let result!: Promise<boolean>;
  await act(async () => {
    result = state.request_confirm(true);
  });
  expect(state.dialog_props.open).toBe(true);
  await act(async () => state.dialog_props.onConfirm());
  expect(await result).toBe(true);
  expect(state.dialog_props.open).toBe(false);

  await act(async () => {
    result = state.request_confirm(true);
  });
  await act(async () => state.dialog_props.onClose());
  expect(await result).toBe(false);

  await act(async () => {
    result = state.request_confirm(true);
  });
  await act(async () => root!.unmount());
  root = null;
  expect(await result).toBe(false);
});
