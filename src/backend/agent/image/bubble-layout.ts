import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { normalize_project_asset_path } from "../../../shared/project/project-asset-paths";
import { read_image_package_manifest } from "../../file/image/image-package";
import { AGENT_WORKSPACE_CHANGE_PATHS, AGENT_WORKSPACE_PATHS } from "../workspace/paths";
import { AGENT_WORKSPACE_ITEM_SCHEMA, type AgentWorkspaceItem } from "../workspace/schema";
import { Check } from "typebox/value";
import { is_json_record } from "../../../domain/json";

type BubbleTarget = { assetPath: string; pageId: string; regionId: string };

/** 只准备条目意图，应用和部分失败恢复仍走工程提交。 */
export function queue_image_bubble_layout(
  workspace: string,
  target: BubbleTarget,
  layout: "split" | "whole",
): { status: "queued"; itemIds: number[] } | { status: "repartition_required" } {
  const asset = normalize_project_asset_path(target.assetPath);
  const { book, records } = read_image_package_manifest(path.join(workspace, "sources", asset));
  const page = book.pages.find(({ pageId }) => pageId === target.pageId);
  const region = page?.regions.find(({ regionId }) => regionId === target.regionId);
  if (!page || !region || region.kind !== "bubble") throw new Error("Unknown image bubble");
  const whole = page.regions.find(
    ({ regionId, parts }) =>
      parts && (regionId === region.regionId || parts.includes(region.regionId)),
  );
  if (!whole?.parts) return { status: "repartition_required" };
  const active = new Set(layout === "split" ? whole.parts : [whole.regionId]);
  const members = new Set([whole.regionId, ...whole.parts]);
  const rows = new Map<number, AgentWorkspaceItem>();
  for (const line of fs
    .read_text_file(path.join(workspace, AGENT_WORKSPACE_PATHS.items))
    .split(/\r?\n/u)) {
    if (!line) continue;
    const item: unknown = JSON.parse(line);
    if (
      is_json_record(item) &&
      item.file_path === asset &&
      Check(AGENT_WORKSPACE_ITEM_SCHEMA, item)
    )
      rows.set(item.row_number, item);
  }
  const itemIds: number[] = [];
  const changes: string[] = [];
  for (const [row, record] of records.entries()) {
    if (record.pageId !== target.pageId || !members.has(record.regionId)) continue;
    const item = rows.get(row);
    if (!item) throw new Error("Missing image bubble item in the workspace snapshot");
    const bubble_active = active.has(record.regionId);
    if (bubble_active) itemIds.push(item.item_id);
    changes.push(JSON.stringify({ item_id: item.item_id, fp: item.fp, bubble_active }));
  }
  // 已有变更清单可能没有尾随换行。
  fs.append_text_file(
    path.join(workspace, AGENT_WORKSPACE_CHANGE_PATHS.items.updates),
    "\n" + changes.join("\n") + "\n",
  );
  return { status: "queued", itemIds };
}
