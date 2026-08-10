import { zh_cn_agent_runtime } from "../zh-CN/agent-runtime";
import type { LocaleMessageSchema } from "../../types";

export const en_us_agent_runtime = {
  message: {
    continue: "Continue",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_agent_runtime>;
