<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AI로 소설, 게임, 자막, 오디오·동영상을 클릭 한 번으로 번역하는 차세대 멀티모달 번역기</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 개요 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)는 AI 기술을 활용한 차세대 다목적 번역기입니다
- 설치 후 바로 사용할 수 있으며, 설정은 (거의) 필요 없습니다. 강력한 기능을 쓰기 위해 복잡한 설정을 거칠 필요가 없습니다
- `중국어`, `영어`, `일본어`, `한국어`, `러시아어`, `독일어`, `프랑스어`, `이탈리아어` 등 16개 언어 간 원클릭 번역을 지원합니다
- `자막`, `전자책`, `게임 엔진`, `오디오(ASMR)`, `동영상(모션 코믹 / 애니메이션)` 등 다양한 입력 형식을 지원합니다
- `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` 등 다양한 로컬 및 온라인 인터페이스를 지원합니다

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

> <img width="1280" alt="동영상 및 모션 코믹 이중 언어 자막 예시" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" />

> <img width="1280" alt="오디오 스펙트럼 시각화 이중 언어 영상 예시" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" />

## 특별 안내 ⚠️
- 번역 과정에서 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용했다면 작품 정보나 배포 페이지의 눈에 잘 띄는 곳에 사용 사실을 밝혀 주세요!
- 프로젝트에 상업적 활동이나 수익이 관련되어 있다면 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용하기 전에 제작자에게 연락하여 허가를 받아 주세요!

## 주요 장점 📌
- 최상의 번역 품질과 가장 빠른 번역 속도
  - 다양한 `자막` `전자책`의 서식을 완벽하게 보존
  - 용어집을 자동으로 생성하여 작품 전체에서 고유 명사의 번역을 일관되게 유지
  - 자막 한 편은 10초, 소설 한 권은 1분, 게임 한 편은 5분
- 대화를 통해 다양한 작업을 자동으로 수행하는 `AGENT` 모드 내장　`👈👈 독보적인 기능`
  - 기술 지식 없이도 게임을 번역 후 바로 플레이 가능
  - 주요 엔진 전체 지원 `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`
  - **`오디오·동영상(ASMR / 모션 코믹) 원스톱 번역`**: 로컬 음성 인식 + 화면 문자 감지를 지원하며, 동영상은 말풍선과 얼굴을 피해 이중 언어 `.ass`를 배치하고 순수 오디오는 `1920×1080` 스펙트럼 시각화 이중 언어 `.mp4`를 자동 생성

## 기본 사용 흐름 🛸
- [릴리스 페이지](https://github.com/neavo/LinguaGacha/releases)에서 앱을 다운로드합니다
  - Windows:
    - CPU 종류에 맞게 `*_Windows_x64.zip` 또는 `*_Windows_arm64.zip`을 다운로드합니다
    - 압축을 풀고 `app.exe`를 더블 클릭하여 실행합니다
  - <details>
    <summary>macOS:</summary>
    - CPU 종류에 맞게 `*_macOS_x64.dmg` 또는 `*_macOS_arm64.dmg`를 다운로드합니다
    - 응용 프로그램 폴더로 드래그한 뒤, 아직 실행하지 않습니다
    - 터미널을 열고 `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app`을 입력한 다음 Enter를 누릅니다
    - 시스템 암호를 입력하고 터미널을 닫으면 정상적으로 실행할 수 있습니다
    </details>
  - <details>
    <summary>Linux:</summary>
    - CPU 종류에 맞게 `*_Linux_x64.AppImage` 또는 `*_Linux_arm64.AppImage`를 다운로드합니다
    - `chmod +x LinguaGacha*.AppImage`로 실행 권한을 부여합니다
    - `./LinguaGacha*.AppImage`를 실행합니다
    </details>
- 신뢰할 수 있는 AI 모델 인터페이스를 준비합니다. 추천:
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ], 그래픽 카드 불필요
- 앱을 실행하고 프로젝트를 만든 뒤 `번역할 파일`, `게임 폴더` 또는 `오디오/동영상`을 `AGENT` 입력창으로 드래그하고 Enter를 누르세요!

## 사용 안내 📝
- **입문 및 미디어**
  - [기초 튜토리얼](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 누구나 따라 할 수 있는 단계별 안내, 초보자 필독`
  - [지원 파일 형식](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[오디오·동영상 번역 (ASMR / 모션 코믹)](https://github.com/neavo/LinguaGacha/wiki/Media)　　[자주 묻는 질문](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **모델 및 설정**
  - [모델 관리](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[기능 설정 및 실험실](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[앱 프록시](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **핵심 기능**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[교정 및 미리보기](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[용어집](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[텍스트 보호](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)
  - [텍스트 치환](https://github.com/neavo/LinguaGacha/wiki/Replacement)　　[MTool 최적화 도구](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[명령줄 모드](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
- **게임 엔진 모범 사례**
  - [공통 워크플로 및 글꼴 변경 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGames): [Godot](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot) · [RenPy](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy) · [Tyrano](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano) · [WOLFRPG](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG) · [RPGMAKER](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
  - [복잡한 암호화가 없는 kirikiri 엔진 기계 번역 노트(커뮤니티)](https://github.com/neavo/LinguaGacha/discussions/181)
- 각 기능에 대한 더 자세한 설명은 [Wiki 홈](https://github.com/neavo/LinguaGacha/wiki)에서 확인할 수 있습니다

## 지원 파일 형식 🏷️
| 유형 | 형식 / 입력 | 설명 |
|:---|:---|:---|
| 오디오 (ASMR / 음성) | 일반 오디오 형식 (커버 포함) | 번역/이중 언어 `.ass` 및 스펙트럼 시각화 이중 언어 `.mp4` 출력 ([[오디오·동영상 번역](https://github.com/neavo/LinguaGacha/wiki/Media)]) |
| 동영상 (애니 / 모션 코믹) | 일반 동영상 형식 | 대사 인식 + 화면 문자 감지 및 말풍선 회피 `.ass` 출력 ([[오디오·동영상 번역](https://github.com/neavo/LinguaGacha/wiki/Media)]) |
| 자막 및 가사 | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | 타임라인과 스타일 보존 |
| 전자책 및 문서 | `.txt` `.md` `.pdf` `.epub` | `.pdf`는 `AGENT` 분석 및 대조 미리보기 지원 |
| `KV-JSON` / `Message-JSON` | `.json` | 출처: [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `Godot` / `ACTION GAME MAKER` | `.exe` 또는 게임 폴더 | 가이드: [[Godot 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)] |
| `RenPy` | `.exe` 또는 게임 폴더 | 가이드: [[RenPy 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)] |
| `Tyrano` | `.exe` 또는 게임 폴더 | 가이드: [[Tyrano 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)] |
| `WOLFRPG` | `.exe` 또는 게임 폴더 | 가이드: [[WOLFRPG 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)] |
| `RPGMAKER MV/MZ / XP/VX/VXAce` | `.exe` 또는 게임 폴더 | 가이드: [[RPGMAKER 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)] |
| `.rpy` `.xlsx` `.trans` | 구형 호환 형식 | `👈 지원 종료 예정` — 게임 폴더 기본 불러오기 권장 |
| 기타 파일 또는 게임 | 모든 형식 | `AGENT` 작업 영역에 드래그하여 자동 식별 및 처리 |

## 최근 업데이트 📅
- 20261113 v0.141.2
  - `오디오 및 동영상` 번역 기능 개선 [1095](../../issues/1092)
  - 수정 및 개선 [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - `오디오 및 동영상` 번역 기능 개선 [#1092](../../issues/1092)
  - 수정 및 개선 [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - `오디오(ASMR)` 번역 추가 [#1085](../../pull/1085)
  - `동영상` 번역 추가 [#1085](../../pull/1085)
  - 수정 및 개선 [#1083](../../issues/1083) [#1084](../../issues/1084)

## 개발 안내 🛠️
- [Go](https://go.dev)와 [`Node.js`](https://nodejs.org)를 설치합니다
- 의존성 설치: `npm install`
- 의존성 업데이트: `npm ci`
- 앱 실행: `npm run dev`
- 릴리스 빌드: `npm run build`
- PR을 제출하기 전에 변경 범위에 맞게 [`docs/WORKFLOW.md`](./docs/WORKFLOW.md)의 해당 검증을 수행해 주세요
- 개발자가 아니라면 [릴리스 페이지](https://github.com/neavo/LinguaGacha/releases)에서 패키징된 버전을 바로 다운로드해 주세요

## 문제 제보 😥
- 실행 로그는 앱 루트 디렉터리의 `log` 등의 폴더에 저장됩니다
- 문제를 제보할 때 해당 로그 파일을 첨부해 주세요
- 그룹에 참여하여 토론하거나 의견을 남길 수도 있습니다
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
