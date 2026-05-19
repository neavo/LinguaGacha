import type { ProjectStoreState } from "@/project/store/project-store";

export function collect_project_item_texts(items: ProjectStoreState["items"]): {
  srcTexts: string[];
  dstTexts: string[];
} {
  const src_texts: string[] = [];
  const dst_texts: string[] = [];

  for (const item of items.values()) {
    src_texts.push(String(item.src ?? ""));
    dst_texts.push(String(item.dst ?? ""));
  }

  return {
    srcTexts: src_texts,
    dstTexts: dst_texts,
  };
}
