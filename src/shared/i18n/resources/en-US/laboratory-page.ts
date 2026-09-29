import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_laboratory_page = {
  title: "Laboratory",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "Adaptive Thinking Level",
      description:
        "In translation tasks, deep thinking <emphasis>uses 3–5 times as many tokens</emphasis>" +
        "\n" +
        "Intelligently adjusts thinking levels in translation tasks" +
        "\n" +
        "To improve token efficiency and save time and money, enabled by default",
    },
    prompt_enhancement_enable: {
      title: "Prompt Enhancement",
      description:
        "Strengthens the AI's instruction following by simulating chain-of-thought reasoning" +
        "\n" +
        "Disabling slightly reduces token usage but significantly reduces AI intelligence, enabled by default",
    },
    mtool_optimizer_enable: {
      title: "MTool Optimizer",
      description:
        "For MTool text, <emphasis> cuts translation time and tokens by up to 40%</emphasis>, enabled by default",
    },
    skip_duplicate_source_text_enable: {
      title: "Skip Duplicate Source Text",
      description:
        "Entries with identical source text in the same file share <emphasis>one translation</emphasis>, enabled by default",
    },
  },
  feedback: {
    refresh_failed: "Unable to refresh laboratory settings. Please try again …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
