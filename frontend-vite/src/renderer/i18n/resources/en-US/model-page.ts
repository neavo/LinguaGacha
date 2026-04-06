import { zh_cn_model_page } from '@/i18n/resources/zh-CN/model-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_model_page = {
  title: 'Model Management',
  summary: 'Model management will host provider setup, switching policy, and runtime readiness as the entry point of the desktop workflow.',
  category: {
    preset: {
      title: 'Preset Models',
      description: 'Built-in preset models of the application',
    },
    custom_google: {
      title: 'Custom Google Models',
      description: 'Custom models compatible with Google Gemini API format',
    },
    custom_openai: {
      title: 'Custom OpenAI Models',
      description: 'Custom models compatible with OpenAI API format',
    },
    custom_anthropic: {
      title: 'Custom Anthropic Models',
      description: 'Custom models compatible with Anthropic Claude API format',
    },
  },
  action: {
    activate: 'Activate Model',
    basic_settings: 'Basic Settings',
    task_settings: 'Task Settings',
    advanced_settings: 'Advanced Settings',
    delete: 'Delete Model',
    reset: 'Reset Model',
    add: 'Add',
    input: 'Input',
    fetch: 'Fetch',
    test: 'Test',
  },
  dialog: {
    basic: {
      title: 'Basic Settings',
      description: 'Manage the model name, endpoint, keys, identifier, and thinking level here.',
    },
    task: {
      title: 'Task Settings',
      description: 'Configure the input, output, concurrency, and RPM limits for each task here.',
    },
    advanced: {
      title: 'Advanced Settings',
      description: 'Configure generation parameters, extra headers, and request body overrides here.',
    },
    selector: {
      title: 'Available Model List',
      description: 'Click an entry to write the model identifier back immediately.',
      loading: 'Loading model list …',
      search_placeholder: 'Filter models …',
      empty: 'No models matched the current filter.',
    },
  },
  confirm: {
    delete: {
      title: 'Confirm Delete Model',
      description: 'Deleting will remove this model from the current category and refresh the snapshot immediately.',
      confirm: 'Delete Model',
    },
    reset: {
      title: 'Confirm Reset Model',
      description: 'Resetting will restore the preset model to its default configuration.',
      confirm: 'Reset Model',
    },
  },
  feedback: {
    refresh_failed: 'Failed to refresh the model snapshot. Please try again later.',
    add_failed: 'Failed to add the model. Please try again later.',
    update_failed: 'Failed to save the model configuration. Please try again later.',
    reorder_failed: 'Failed to save the model order. Please try again later.',
    delete_last_one: 'At least one model must remain in each category.',
    reset_success: 'Model reset successfully.',
    json_format_error: 'JSON format error. Please enter a valid JSON object.',
    selector_load_failed: 'Failed to load the model list. Please check the API configuration.',
    test_failed: 'Failed to test the model. Please try again later.',
  },
  fields: {
    name: {
      title: 'Model Name',
      description: 'Enter a model name used only for display inside the application.',
      placeholder: 'Please enter model name …',
    },
    api_url: {
      title: 'API URL',
      description: 'Enter the endpoint URL and check whether /v1 should be included at the end.',
      placeholder: 'Please enter API URL …',
    },
    api_key: {
      title: 'API Key',
      description: 'Enter API keys here. When multiple keys are used, put one key on each line.',
      placeholder: 'Please enter API Key …',
    },
    model_id: {
      title: 'Model Identifier',
      description: 'Current model identifier: {MODEL}.',
      placeholder: 'Please enter model identifier …',
    },
    thinking: {
      title: 'Thinking Level',
      description: 'Configure the model thinking behavior, which affects latency and cost.',
    },
    input_token_limit: {
      title: 'Input Token Limit',
      description: 'Maximum number of tokens allowed for each task input.',
    },
    output_token_limit: {
      title: 'Output Token Limit',
      description: 'Maximum number of tokens allowed for each task output, 0 = Automatic.',
    },
    rpm_limit: {
      title: 'Requests Per Minute Limit (RPM)',
      description: 'Limits how many requests this model can send per minute, 0 = Automatic.',
    },
    concurrency_limit: {
      title: 'Concurrent Task Limit',
      description: 'Limits how many tasks this model can run concurrently, 0 = Automatic.',
    },
    top_p: {
      title: 'top_p',
      description: 'Please configure with care. Invalid values may cause errors or unexpected responses.',
    },
    temperature: {
      title: 'temperature',
      description: 'Please configure with care. Invalid values may cause errors or unexpected responses.',
    },
    presence_penalty: {
      title: 'presence_penalty',
      description: 'Please configure with care. Invalid values may cause errors or unexpected responses.',
    },
    frequency_penalty: {
      title: 'frequency_penalty',
      description: 'Please configure with care. Invalid values may cause errors or unexpected responses.',
    },
    extra_headers: {
      title: 'Custom Request Headers',
      description: 'Customize request headers carefully. Invalid values may cause errors or unexpected responses.',
      placeholder: 'Example: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: 'Custom Request Body',
      description: 'Customize request body parameters carefully. Invalid values may cause errors or unexpected responses.',
      placeholder: 'Example: {"seed": 42}',
    },
  },
  thinking_level: {
    off: 'Off',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>
