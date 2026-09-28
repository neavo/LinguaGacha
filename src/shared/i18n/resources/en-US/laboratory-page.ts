import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_laboratory_page = {
  title: "Laboratory",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "Adaptive Thinking Level",
      description:
        "Deep thinking often <emphasis>increases token usage by 3–5 times</emphasis> in translation tasks" +
        "\n" +
        "When enabled, automatically adjusts the thinking level in translation tasks to improve token efficiency. Enabled by default.",
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
        "Per file, entries with identical text, character names and text rules share <emphasis>one translation</emphasis>. Enabled by default.",
    },
  },
  feedback: {
    refresh_failed: "Unable to refresh laboratory settings. Please try again …",
    update_failed: "Failed to save laboratory settings. Please try again …",
    mtool_optimizer_loading_toast: "Refreshing project cache …",
    skip_duplicate_source_text_loading_toast: "Refreshing project cache …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
