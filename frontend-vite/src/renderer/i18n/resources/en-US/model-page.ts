import { zh_cn_model_page } from '@/i18n/resources/zh-CN/model-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_model_page = {
  title: 'Model Management',
  summary: 'Model management will host provider setup, switching policy, and runtime readiness as the entry point of the desktop workflow',
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
    activate: 'Activate',
    basic_settings: 'Basic Settings',
    task_settings: 'Task Settings',
    advanced_settings: 'Advanced Settings',
    delete: 'Delete',
    reset: 'Reset',
    add: 'Add',
    input: 'Input',
    fetch: 'Fetch',
    test: 'Test',
  },
  dialog: {
    selector: {
      loading: 'Loading model list …',
      search_placeholder: 'Filter models …',
      empty: 'No models matched the current filter',
    },
    model_id_input: {
      confirm: 'Confirm',
    },
  },
  confirm: {
    delete: {
      title: 'Confirm',
      description: 'Confirm to delete data …?',
      confirm: 'Confirm',
    },
    reset: {
      title: 'Confirm',
      description: 'Confirm to reset data …?',
      confirm: 'Confirm',
    },
  },
  feedback: {
    refresh_failed: 'Failed to refresh the model snapshot. Please try again later',
    add_failed: 'Failed to add the model. Please try again later',
    update_failed: 'Failed to save the model configuration. Please try again later',
    reorder_failed: 'Failed to save the model order. Please try again later',
    delete_last_one: 'At least one model must remain in each category',
    reset_success: 'Model reset successfully',
    json_format_error: 'JSON format error. Please enter a valid JSON object',
    selector_load_failed: 'Failed to load the model list. Please check the API configuration',
    test_failed: 'Failed to test the model. Please try again later',
  },
  fields: {
    name: {
      title: 'Model Name',
      description: 'Enter a model name used only for display inside the application',
      placeholder: 'Please enter model name …',
    },
    api_url: {
      title: 'API URL',
      description: 'Enter API URL and check whether /v1 should be included at the end',
      placeholder: 'Please enter API URL …',
    },
    api_key: {
      title: 'API Key',
      description: 'Enter API keys here. When multiple keys are used, put one key on each line',
      placeholder: 'Please enter API Key …',
    },
    model_id: {
      title: 'Model Identifier',
      description: 'Current model identifier: {MODEL}',
      placeholder: 'Please enter model identifier …',
    },
    thinking: {
      title: 'Thinking Level',
      description: 'Configure the model thinking behavior, which affects latency and cost',
      help_label: 'Open thinking level support documentation',
    },
    input_token_limit: {
      title: 'Input Token Limit',
      description: 'Maximum number of tokens allowed for each task input',
    },
    output_token_limit: {
      title: 'Output Token Limit',
      description: 'Maximum number of tokens allowed for each task output, 0 = Automatic',
    },
    rpm_limit: {
      title: 'Requests Per Minute Limit (RPM)',
      description: 'Limits how many requests this model can send per minute, 0 = Automatic',
    },
    concurrency_limit: {
      title: 'Concurrent Task Limit',
      description: 'Limits how many tasks this model can run concurrently, 0 = Automatic',
    },
    top_p: {
      title: 'top_p',
      description: 'Please be careful, invalid values may cause errors',
    },
    temperature: {
      title: 'temperature',
      description: 'Please be careful, invalid values may cause errors',
    },
    presence_penalty: {
      title: 'presence_penalty',
      description: 'Please be careful, invalid values may cause errors',
    },
    frequency_penalty: {
      title: 'frequency_penalty',
      description: 'Please be careful, invalid values may cause errors',
    },
    extra_headers: {
      title: 'Custom Request Headers',
      description: 'Please be careful, invalid values may cause errors',
      placeholder: 'Example: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: 'Custom Request Body',
      description: 'Please be careful, invalid values may cause errors',
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
