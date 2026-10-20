import type { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_basic_settings_page = {
  title: "기본 설정",
  fields: {
    source_language: {
      description: "입력 텍스트 언어를 설정합니다",
    },
    target_language: {
      description: "출력 텍스트 언어를 설정합니다",
    },
    project_save_mode: {
      title: "프로젝트 파일 저장 위치",
      description: "새 프로젝트를 만들 때 프로젝트 파일을 저장할 위치를 설정합니다",
      description_fixed:
        "새 프로젝트를 만들 때 프로젝트 파일을 저장할 위치를 설정합니다" + "\n" + "현재: {PATH}",
      options: {
        manual: "매번 직접 선택",
        fixed: "지정 폴더",
        source: "원본 파일과 같은 폴더",
      },
    },
    output_folder_open_on_finish: {
      title: "번역문 파일 생성 후 출력 폴더 열기",
      description: "번역문 파일이 생성되면 출력 폴더를 자동으로 엽니다",
    },
    request_timeout: {
      title: "요청 제한 시간",
      description:
        "모델 응답을 기다리는 최대 시간(초)입니다. 시간 내에 응답이 없으면 작업을 실패로 처리합니다",
    },
    proxy: {
      title: "아웃바운드 프록시",
      description: "번역, Agent, 앱 업데이트의 네트워크 요청에 적용됩니다",
      protocol_label: "프로토콜",
      server_label: "프록시 서버",
      address_label: "주소",
      port_label: "포트",
      host_placeholder: "proxy.example.com",
      server_description:
        "호스트 이름 또는 IP만 입력하고 http://와 포트는 넣지 않습니다. IPv6는 [::1]처럼 대괄호로 묶습니다",
      port_placeholder: "포트",
      auth_label: "인증(선택)",
      username_placeholder: "사용자 이름",
      auth_description:
        "사용자 이름과 비밀번호는 이 컴퓨터에 평문으로 저장되며 이 프록시에만 사용됩니다",
      password_placeholder: "비밀번호",
      save: "프록시 설정 저장",
      test: "연결 테스트",
    },
  },
  status: {
    apply_failed: "프록시 설정을 적용하지 못해 시스템 프록시로 전송합니다: {REASON}",
    manual_incomplete: "수동 프록시 설정이 불완전하거나 유효하지 않아 시스템 프록시로 전송합니다",
    socks5_auth:
      "SOCKS5 인증은 앱 업데이트에서 사용할 수 없으며, 업데이트는 시스템 프록시를 사용합니다",
  },
  probe: {
    running: "테스트 중 …",
    succeeded: "성공 · {ELAPSED} ms",
    failed: "실패 · {ELAPSED} ms: {REASON}",
    route: "· 실제 경로 {ROUTE}",
    route_failed: "· 경로 확인 실패",
  },
  feedback: {
    proxy_host_invalid:
      "주소는 필수이며 http://, 포트, 공백을 포함할 수 없습니다. IPv6는 대괄호로 묶으세요",
    proxy_port_invalid: "포트는 1–65535 사이의 정수여야 합니다",
    proxy_username_required: "비밀번호를 입력하면 사용자 이름도 입력해야 합니다",
    proxy_saved: "프록시 설정을 저장했습니다",
    proxy_test_failed: "연결 테스트 실패",
    proxy_test_unsaved: "변경 사항을 저장한 후 테스트하세요",
    request_timeout_invalid: "요청 제한 시간에 유효한 범위의 숫자를 입력해 주세요 …",
    pick_directory_failed: "폴더를 선택하지 못했습니다. 지정 저장 폴더를 다시 선택해 주세요 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
