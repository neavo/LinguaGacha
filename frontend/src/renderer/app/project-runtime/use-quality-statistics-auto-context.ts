import { useEffect, useMemo, useState } from "react";

import { collect_project_item_texts } from "@/app/project-runtime/project-item-texts";
import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  createQualityStatisticsAutoContext,
  type QualityStatisticsAutoContext,
  type QualityStatisticsAutoRuleDescriptor,
  type QualityStatisticsAutoTextSource,
} from "@/app/project-runtime/quality-statistics-auto";

type QualityStatisticsPreparedContextState = {
  request_key: string;
  project_item_texts: {
    srcTexts: string[];
    dstTexts: string[];
  };
  context: QualityStatisticsAutoContext;
};

function build_context_request_key(args: {
  text_source: QualityStatisticsAutoTextSource;
  item_revision: number;
  descriptors: QualityStatisticsAutoRuleDescriptor[];
}): string {
  return JSON.stringify({
    text_source: args.text_source,
    item_revision: args.item_revision,
    descriptors: args.descriptors.map((descriptor) => {
      return {
        key: descriptor.key,
        dependency_parts: descriptor.dependency_parts,
        relation_label: descriptor.relation_label,
      };
    }),
  });
}

export function useQualityStatisticsAutoContext(args: {
  items: ProjectStoreState["items"];
  item_revision: number;
  text_source: QualityStatisticsAutoTextSource;
  descriptors: QualityStatisticsAutoRuleDescriptor[];
}): {
  pending: boolean;
  project_item_texts: { srcTexts: string[]; dstTexts: string[] } | null;
  current_statistics_context: QualityStatisticsAutoContext | null;
} {
  const request_key = useMemo(() => {
    return build_context_request_key({
      text_source: args.text_source,
      item_revision: args.item_revision,
      descriptors: args.descriptors,
    });
  }, [args.descriptors, args.item_revision, args.text_source]);
  const [prepared_state, set_prepared_state] =
    useState<QualityStatisticsPreparedContextState | null>(null);

  useEffect(() => {
    const timer_id = window.setTimeout(() => {
      const project_item_texts = collect_project_item_texts(args.items);
      const context = createQualityStatisticsAutoContext({
        text_source: args.text_source,
        texts:
          args.text_source === "dst" ? project_item_texts.dstTexts : project_item_texts.srcTexts,
        descriptors: args.descriptors,
      });

      set_prepared_state({
        request_key,
        project_item_texts,
        context,
      });
    }, 0);

    return () => {
      window.clearTimeout(timer_id);
    };
  }, [args.descriptors, args.items, args.text_source, request_key]);

  const current_state = prepared_state?.request_key === request_key ? prepared_state : null;
  return {
    pending: current_state === null,
    project_item_texts: current_state?.project_item_texts ?? null,
    current_statistics_context: current_state?.context ?? null,
  };
}
