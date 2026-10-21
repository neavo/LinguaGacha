import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { GodotPackOrder, GodotPackPreview } from "@shared/godot";
import { useGodotPackOrder } from "./use-godot-pack-order";

let state: ReturnType<typeof useGodotPackOrder>;
let root: Root | null;
let container: HTMLDivElement;

/** 通过 Hook 的公开草稿与完成结果观察会话生命周期。 */
function Probe() {
  state = useGodotPackOrder();
  return null;
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

const game: GodotPackPreview = {
  game_root: "C:/game",
  game_name: "game",
  external_pcks: ["base.pck", "patch.pck"],
};

it("确认合并多包草稿与零包、单包快照，顺序只在确认时交付", async () => {
  const fixed = [
    { game_root: "C:/loose", game_name: "loose", external_pcks: [] },
    { game_root: "C:/single", game_name: "single", external_pcks: ["game.pck"] },
  ];
  const defaults = fixed.map((entry) => ({
    game_root: entry.game_root,
    ordered_pcks: entry.external_pcks,
  }));
  await act(async () => {
    expect(await state.request_order(fixed)).toEqual(defaults);
  });
  let result!: Promise<readonly GodotPackOrder[] | null>;
  await act(async () => {
    result = state.request_order([...fixed, game]);
  });
  expect(state.dialog_props.games).toEqual([game]);
  await act(async () => state.dialog_props.on_reorder(game.game_root, ["patch.pck", "base.pck"]));
  await act(async () => state.dialog_props.on_confirm());
  expect(await result).toEqual([
    ...defaults,
    { game_root: game.game_root, ordered_pcks: ["patch.pck", "base.pck"] },
  ]);
  expect(game.external_pcks).toEqual(["base.pck", "patch.pck"]);
});

it("重新请求重置草稿，替换、关闭与卸载均结束旧等待", async () => {
  let first!: Promise<readonly GodotPackOrder[] | null>,
    second!: typeof first,
    third!: typeof first;
  await act(async () => {
    first = state.request_order([game]);
  });
  await act(async () => state.dialog_props.on_reorder(game.game_root, ["patch.pck", "base.pck"]));
  await act(async () => {
    second = state.request_order([game]);
  });
  expect(await first).toBeNull();
  expect(state.dialog_props.games).toEqual([game]);
  await act(async () => state.dialog_props.on_close());
  expect(await second).toBeNull();
  await act(async () => {
    third = state.request_order([game]);
  });
  await act(async () => {
    root?.unmount();
    root = null;
  });
  expect(await third).toBeNull();
});
