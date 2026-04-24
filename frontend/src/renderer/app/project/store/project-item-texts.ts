import type { ProjectStoreState } from "@/app/project/store/project-store";

export function collect_project_item_texts(items: ProjectStoreState["items"]): {
  srcTexts: string[];
  dstTexts: string[];
} {
  const src_texts: string[] = [];
  const dst_texts: string[] = [];

  for (const item of Object.values(items)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    src_texts.push(String((item as { src?: string }).src ?? ""));
    dst_texts.push(String((item as { dst?: string }).dst ?? ""));
  }

  return {
    srcTexts: src_texts,
    dstTexts: dst_texts,
  };
}
