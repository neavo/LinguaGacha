<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>올인원 번역 AGENT Harness · 오디오 동영상 게임 전자책 · 원클릭 · 고품질 · 전 형식</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 개요 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), 번역에 특화된 차세대 `AGENT Harness`
- `원클릭`
  - 다양한 언어 간 전자동 원클릭 상호 번역
  - 끌어다 놓고 시작만 누르면 바로 완성본 수령
  - 기술적 배경이나 외국어 지식이 전혀 필요 없음
- `고품질`
  - 모델 검열 제한 없는 자유로운 출력
  - 용어집을 자동 생성하여 작품 전체에서 고유 명사를 일관되게 유지
  - 다양한 `자막` `전자책` `게임 엔진`의 서식과 스타일을 완벽하게 보존
  - 시맨틱 스마트 검수: 문제점만 짚어 주면 `AGENT`가 알아서 수정하고 다듬기
- `전 형식`
  - 다음을 비롯한 모든 콘텐츠 번역 가능:
  - 오디오 및 동영상 - `ASMR` `애니메이션` `영화 및 드라마` `모션 코믹스` 등
  - 자막 및 전자책 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc` 등
  - 게임 엔진 및 데이터 파일 - `Godot` `ACTION GAME MAKER` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `KV-JSON` `Message-JSON` 등

> <img width="1600" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="1600" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 특별 안내 ⚠️
- 번역 과정에서 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용했다면 작품 정보나 배포 페이지의 눈에 잘 띄는 곳에 사용 사실을 밝혀 주세요!
- 프로젝트에 상업적 활동이나 수익이 관련되어 있다면 [LinguaGacha](https://github.com/neavo/LinguaGacha)를 사용하기 전에 제작자에게 연락하여 허가를 받아 주세요!

## 번역 결과 미리보기 ✨
<table>
  <tbody>
    <tr><td><details open><summary><b>🎬 동영상 · 대사 단위 정밀 타임라인 동기화</b></summary><br><img width="1280" alt="동영상" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details><summary><b>🎧 오디오 · 자막/스펙트럼 시각화 이중 출력</b></summary><br><img width="1280" alt="오디오" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
  </tbody>
</table>

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
- [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]과 같은 신뢰할 수 있는 AI 모델 API를 준비합니다
- 앱을 실행하고 프로젝트를 만든 뒤 `번역할 파일`을 `AGENT` 입력창으로 드래그하고 Enter를 누르세요!

## 사용 안내 📝
- **입문**
  - [기초 튜토리얼](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 누구나 따라 할 수 있는 단계별 안내, 초보자 필독`
  - [모델 관리](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[지원 파일 형식](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[자주 묻는 질문](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **기능**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[교정](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[용어집](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[텍스트 보호](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[텍스트 치환](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [사용자 정의 프롬프트](https://github.com/neavo/LinguaGacha/wiki/CustomPrompt)　　[실험실](https://github.com/neavo/LinguaGacha/wiki/Laboratory)　　[기능 설정](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[MTool 최적화 도구](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[명령줄 모드](https://github.com/neavo/LinguaGacha/wiki/CLIMode)　　[고급 기능](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **모범 사례**
  - [오디오·동영상 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/Media)
  - [Godot 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [RenPy 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [Tyrano 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [WOLFRPG 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [RPGMAKER 엔진 게임 고품질 번역 가이드](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 각 기능에 대한 더 자세한 설명은 [Wiki](https://github.com/neavo/LinguaGacha/wiki)에서 확인할 수 있습니다

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
