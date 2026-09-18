<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AI로 소설, 게임, 자막 등 다양한 텍스트를 클릭 한 번으로 번역하는 차세대 텍스트 번역기</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] | [ [한국어](./README_KO.md) ] | [ [Deutsch](./README_DE.md) ]

## 개요 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)는 AI 기술을 활용한 차세대 텍스트 번역기입니다
- 설치 후 바로 사용할 수 있으며, 설정은 (거의) 필요 없습니다. 강력한 기능을 쓰기 위해 복잡한 설정을 거칠 필요가 없습니다
- `중국어`, `영어`, `일본어`, `한국어`, `러시아어`, `독일어`, `프랑스어`, `이탈리아어` 등 16개 언어 간 원클릭 번역을 지원합니다
- `자막`, `전자책`, `게임 텍스트` 등 다양한 텍스트 유형과 파일 형식을 지원합니다
- `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` 등 다양한 로컬 및 온라인 인터페이스를 지원합니다

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 특별 안내 ⚠️
- 번역 과정에서 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용했다면 작품 정보나 배포 페이지의 눈에 잘 띄는 곳에 사용 사실을 밝혀 주세요!
- 프로젝트에 상업적 활동이나 수익이 관련되어 있다면 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용하기 전에 제작자에게 연락하여 허가를 받아 주세요!

## 주요 장점 📌
- 대화를 통해 다양한 작업을 자동으로 수행하는 `AGENT` 모드 내장　`👈👈 독보적인 기능`
- 매우 빠른 번역 속도: 자막 한 편은 10초, 소설 한 권은 1분, 게임 한 편은 5분
- 클릭 한 번으로 용어집을 생성하여 등장인물 이름 등 고유 명사의 번역을 작품 전체에서 일관되게 유지
- `DeepSeek-R1 같은` 최고급 모델부터 `Qwen2.5-7B 같은` 소형 로컬 모델까지 최상의 번역 품질 제공
- 동종 앱 중 가장 뛰어난 서식 및 코드 보존 능력으로 후처리 작업을 크게 줄여, 게임에 직접 적용하는 중국어 패치 제작에 적합
  - `.md`, `.ass`, `.epub` 형식은 원래 서식을 거의 모두 보존
  - 대부분의 `WOLF`, `RenPy`, `RPGMaker`, `Kirikiri` 엔진 게임은 수동 처리 없이 번역 후 바로 플레이 가능

## 기본 사용 흐름 🛸
- [릴리스 페이지](https://github.com/neavo/LinguaGacha/releases)에서 앱을 다운로드합니다
  - Windows:
    - CPU 종류에 맞게 `*_Windows_x64.zip` 또는 `*_Windows_arm64.zip`을 다운로드합니다
    - 압축을 풀고 `app.exe`를 더블 클릭하여 실행합니다
  - macOS:
    - CPU 종류에 맞게 `*_macOS_x64.dmg` 또는 `*_macOS_arm64.dmg`를 다운로드합니다
    - 응용 프로그램 폴더로 드래그한 뒤, 아직 실행하지 않습니다
    - 터미널을 열고 `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app`을 입력한 다음 Enter를 누릅니다
    - 시스템 암호를 입력하고 터미널을 닫으면 정상적으로 실행할 수 있습니다
  - Linux:
    - CPU 종류에 맞게 `*_Linux_x64.AppImage` 또는 `*_Linux_arm64.AppImage`를 다운로드합니다
    - `chmod +x LinguaGacha*.AppImage`로 실행 권한을 부여합니다
    - `./LinguaGacha*.AppImage`를 실행합니다
- 신뢰할 수 있는 AI 모델 인터페이스를 준비합니다. 추천:
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ], 그래픽 카드 불필요
- 번역할 텍스트를 준비합니다
  - `자막`, `전자책` 등은 일반적으로 전처리가 필요 없습니다
  - `게임 텍스트`는 게임 엔진에 맞는 도구를 선택하여 추출해야 합니다
- 앱을 실행합니다
  - `번역할 파일`을 페이지로 드래그하여 프로젝트를 만듭니다
  - `기본 설정`에서 원문 언어, 번역문 언어 등 필요한 정보를 설정합니다
  - `AGENT`에서 모델을 선택하고 화면에 미리 설정된 지시를 차례로 클릭하여 다음 단계를 수행합니다:
    - `용어 추출`　`👈👈 선택 사항이지만 권장합니다. 번역 품질에 중요합니다`
    - `전체 번역`
    - `자동 교정`　`👈👈 선택 사항이지만 권장합니다. 번역 품질에 중요합니다`
  - `AGENT`에서 번역문 생성을 클릭합니다

## 사용 안내 📝
- 종합
  - [기초 튜토리얼](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 누구나 따라 할 수 있는 단계별 안내, 초보자 필독`
  - [WOLF 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF)
  - [RenPy 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [RPGMaker 시리즈 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 동영상 튜토리얼
  - [LinguaGacha와 Translator++로 RPGMV 번역하기 (영어)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- 기능 설명
  - [명령줄 모드](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
  - [용어집](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[텍스트 보호](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[텍스트 치환](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [MTool 최적화 도구](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)
- 각 기능에 대한 더 자세한 설명은 [Wiki](https://github.com/neavo/LinguaGacha/wiki)에서 확인할 수 있습니다. [토론 게시판](https://github.com/neavo/LinguaGacha/discussions)에 사용 경험을 공유해 주세요

## 지원 파일 형식 🏷️
- 자막 `.srt .ass`
- 전자책 `.txt .pdf .epub`
- Markdown `.md`
- [RenPy](https://www.renpy.org)로 내보낸 게임 텍스트 `.rpy`
- [MTool](https://mtool.app)로 내보낸 게임 텍스트 `.json`
- [SExtractor](https://github.com/satan53x/SExtractor)로 내보낸 게임 텍스트 `.txt .json .xlsx`
- [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)로 내보낸 게임 텍스트 `.json`
- [Translator++](https://dreamsavior.net/translator-plusplus) 프로젝트 파일 `.trans`
- [Translator++](https://dreamsavior.net/translator-plusplus)로 내보낸 게임 텍스트 `.xlsx`
- [WOLF 공식 번역 도구](https://silversecond.booth.pm/items/5151747)로 내보낸 게임 텍스트 `.xlsx`
- 구체적인 예시는 [Wiki - 지원 파일 형식](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)을 참고하세요. 지원 형식은 계속 추가되며, [ISSUES](https://github.com/neavo/LinguaGacha/issues)에서 원하는 형식을 요청할 수 있습니다

## 최근 업데이트 📅
- 20260918 v0.122.0
  - `.pdf` 파일 지원 추가 [#895](../../issues/895)
    - `AGENT` 모드에서만 번역할 수 있습니다
    - `일반 텍스트`와 `이미지 텍스트` 지원
  - `OpenCode Go` 특수 필드 규칙 지원 [#894](../../issues/894)
  - 수정 및 개선 [#877](../../issues/877) [#888](../../issues/888) [#890](../../issues/890) [#891](../../issues/891) [#892](../../issues/892) [#893](../../issues/893) [#896](../../issues/896) [#897](../../issues/897) [#898](../../issues/898) [#899](../../issues/899)

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
