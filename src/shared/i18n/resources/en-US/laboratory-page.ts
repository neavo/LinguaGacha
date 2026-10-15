import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_laboratory_page = {
  title: "Laboratory",
  fields: {
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
        "Entries with identical text across the project share <emphasis>one translation</emphasis>, enabled by default",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
