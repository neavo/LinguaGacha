import { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_basic_settings_page = {
  title: "Basic Settings",
  fields: {
    source_language: {
      description: "Set the language of the input text",
    },
    target_language: {
      description: "Set the language of the output text",
    },
    project_save_mode: {
      title: "Project Save Location",
      description: "Set the save location for project files when creating a new project",
      description_fixed:
        "Set the save location for project files when creating a new project" +
        "\n" +
        "currently {PATH}",
      options: {
        manual: "Choose every time",
        fixed: "Fixed directory",
        source: "Next to source files",
      },
    },
    output_folder_open_on_finish: {
      title: "Open Output Folder When Translation File Is Generated",
      description:
        "When enabled, the output folder will be opened after the translated file is generated successfully",
    },
    request_timeout: {
      title: "Request Timeout",
      description:
        "Maximum wait for a model reply, in seconds. The task fails if no reply arrives in time.",
    },
    proxy: {
      title: "Outbound Proxy",
      description: "Applies to requests from translation, Agent and app updates",
      protocol_label: "Protocol",
      server_label: "Proxy server",
      address_label: "Address",
      port_label: "Port",
      host_placeholder: "proxy.example.com",
      server_description:
        "Enter only the host name or IP, without http:// or port; wrap IPv6 in brackets, e.g. [::1]",
      port_placeholder: "Port",
      auth_label: "Authentication (optional)",
      username_placeholder: "Username",
      auth_description:
        "The username and password are stored in plain text on this machine and apply only to this proxy",
      password_placeholder: "Password",
      save: "Save proxy settings",
      test: "Test connection",
    },
  },
  status: {
    apply_failed:
      "Proxy settings could not be applied; outbound requests use the system proxy: {REASON}",
    manual_incomplete:
      "The manual proxy is incomplete or invalid; outbound requests use the system proxy",
    socks5_auth:
      "SOCKS5 authentication is unavailable for app updates; updates will use the system proxy",
  },
  probe: {
    running: "Testing …",
    succeeded: "Succeeded · {ELAPSED} ms",
    failed: "Failed · {ELAPSED} ms: {REASON}",
    route: "· Actual route {ROUTE}",
    route_failed: "· Route resolution failed",
  },
  feedback: {
    proxy_host_invalid:
      "The address is required and must not include http://, a port or spaces; use brackets for IPv6",
    proxy_port_invalid: "Port must be an integer between 1 and 65535",
    proxy_username_required: "Username is required when a password is set",
    proxy_saved: "Proxy settings saved",
    proxy_test_failed: "Connection test failed",
    proxy_test_unsaved: "Save your changes before testing",
    request_timeout_invalid: "Request timeout must be a number within the valid range …",
    pick_directory_failed:
      "Directory selection failed. Please choose the fixed save directory again …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
