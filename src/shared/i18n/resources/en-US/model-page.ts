import { zh_cn_model_page } from "../zh-CN/model-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_model_page = {
  auth: {
    open_login_page: "Open sign-in page in default browser",
    copy_link: "Copy link",
    copied: "Copied",
    success: "Click to sign in …",
    login: "Click to sign in",
    logout: "Sign out",
  },
  title: "Model Management",
  category: {
    preset: {
      description: "Built-in preset models of the application",
    },
    custom_google: {
      description: "Custom models compatible with Google Gemini API format",
    },
    custom_openai: {
      description: "Custom models compatible with OpenAI API format",
    },
    custom_openai_responses: {
      description: "Custom models compatible with OpenAI Responses API format",
    },
    custom_anthropic: {
      description: "Custom models compatible with Anthropic Claude API format",
    },
  },
  copy_name: "{NAME}_copy",
  action: {
    reset: "Reset model",
    delete: "Delete model",
    copy: "Duplicate",
    basic_settings: "Basic Settings",
    task_settings: "Task Settings",
    advanced_settings: "Advanced Settings",
    input: "Input",
    fetch: "Fetch",
    test: "Test",
  },
  dialog: {
    selector: {
      loading: "Loading model list …",
      search_placeholder: "Filter models …",
      empty: "No valid data …",
    },
  },
  confirm: {
    logout: { description: "Are you sure you want to sign out …?" },
    delete: {
      description: "Confirm deleting the model …?",
    },
    reset: {
      description: "Confirm resetting the model …?",
    },
  },
  feedback: {
    copy_success: "Model duplicated\nGroup: {CATEGORY}\nName: {NAME}",
    delete_last_one: "At least one model must remain in each category …",
    agent_limits_adjusted: "Invalid settings were adjusted to a valid configuration …",
    json_format_error: "JSON format error. Please enter a valid JSON object …",
    test_failed: "Failed to test the model. Please try again later …",
  },
  fields: {
    speed: {
      ultrafast: "UltraFast",
      default_description: "Leave the speed level unspecified and use the platform default.",
      title: "Speed level",
      description:
        "Set the model’s speed level. The provider determines whether it takes effect. Additional charges apply when it does.",
      standard: "Standard",
      fast: "Fast",
      default: "Keep default",
    },
    context_window: {
      title: "Context Window",
      description: "Only applies to AGENT tasks; 0 = automatic",
    },
    max_output_tokens: {
      title: "Maximum Output Length",
      description: "Only applies to AGENT tasks; 0 = automatic",
    },
    name: {
      title: "Model Name",
      description: "Enter a model name used only for display inside the application",
      placeholder: "Please enter model name …",
    },
    api_url: {
      title: "API URL",
      description: "Enter API URL and check whether /v1 should be included at the end",
      placeholder: "Please enter API URL …",
    },
    api_key: {
      title: "API Key",
      description:
        "Enter API Key, e.g., sk-d0daba12345678fd8eb7b8d31c123456, multiple keys can be entered for polling, one key per line",
      placeholder: "Please enter API Key …",
    },
    model_id: {
      title: "Model Identifier",
      description: "Current model identifier: {MODEL}",
      placeholder: "Please enter model identifier …",
    },
    thinking: {
      title: "Thinking Level",
      description: "Configure the model's thinking behavior, which affects time and usage",
    },
    input_token_limit: {
      title: "Input Token Limit",
      description: "Maximum number of tokens allowed for each task input",
    },
    output_token_limit: {
      title: "Output Token Limit",
      description: "Maximum number of tokens allowed for each task output, 0 = Automatic",
    },
    rpm_limit: {
      title: "Requests Per Minute Limit (RPM)",
      description: "Limits how many requests this model can send per minute, 0 = Automatic",
    },
    concurrency_limit: {
      title: "Concurrent Task Limit",
      description: "Limits how many tasks this model can run concurrently, 0 = Automatic",
    },
    top_p: {
      title: "top_p",
      description: "Please be careful, invalid values may cause errors",
    },
    temperature: {
      title: "temperature",
      description: "Please be careful, invalid values may cause errors",
    },
    extra_headers: {
      title: "Custom Request Headers",
      description:
        "Please set with caution, incorrect values may cause abnormal results or request errors",
      placeholder: 'Example: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "Custom Request Body",
      description:
        "Please set with caution, incorrect values may cause abnormal results or request errors",
      placeholder: 'Example: {"seed": 42}',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>;
