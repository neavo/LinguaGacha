<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>万能翻訳 AGENT Harness · 音声 動画 ゲーム 電子書籍 · ワンクリック · 高品質 · 全形式</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 概要 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、翻訳に特化した次世代の `AGENT Harness`
- `ワンクリック`
  - 多言語間の全自動ワンクリック相互翻訳
  - ドラッグして開始を押すだけで完成品を取得
  - 技術的な背景知識も外国語の知識も不要
- `高品質`
  - モデルの検閲制限を受けない自由な出力
  - 用語集を自動生成し、固有名詞の訳語を作品全体で統一
  - 各種 `字幕` `電子書籍` `ゲームエンジン` のレイアウトとスタイルを完全に保持
  - セマンティックなスマート校正：問題点を伝えるだけで `AGENT` が自動で修正・推敲
- `全形式`
  - あらゆる形式を翻訳可能（一例）：
  - 音声・動画 - `ASMR` `アニメ` `映画・ドラマ` `モーションコミック` など
  - 字幕・電子書籍 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc` など
  - ゲームエンジン・データファイル - `Godot` `ACTION GAME MAKER` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `KV-JSON` `Message-JSON` など

> <img width="1600" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="1600" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特別なお知らせ ⚠️
- 翻訳中に [LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する場合は、作品の情報やリリースページの目立つ場所に明確な帰属を含めてください！
- 商業活動や利益を伴うプロジェクトの場合は、[LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する前に、著者に連絡して許可を得てください！

## 翻訳サンプル ✨
<table>
  <tbody>
    <tr><td><details open><summary><b>🎬 動画 · セリフごとの精密タイムライン同期</b></summary><br><img width="1280" alt="動画" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details><summary><b>🎧 音声 · 字幕＋スペクトラム可視化動画を同時出力</b></summary><br><img width="1280" alt="音声" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
  </tbody>
</table>

> 💡 **あらゆる形式を翻訳可能（一例）：**
>
> - **音声・動画**：`ASMR` `アニメ` `映画・ドラマ` `モーションコミック` など
> - **字幕・電子書籍**：`.txt` `.md` `.epub` `.pdf`、`.srt` `.ass` `.ssa` `.vtt` `.lrc` など
> - **ゲームエンジン・データ**：`Godot`、`ACTION GAME MAKER`、`RenPy`、`Tyrano`、`WOLFRPG`、`RPGMAKER`、`KV-JSON`、`Message-JSON` など

## ワークフロー 🛸
- [リリースページ](https://github.com/neavo/LinguaGacha/releases) からアプリケーションをダウンロード
  - Windows:
    - CPU の種類に応じて `*_Windows_x64.zip` または `*_Windows_arm64.zip` をダウンロード
    - 解凍して `app.exe` をダブルクリックして起動
  - <details>
    <summary>macOS:</summary>
    - CPU の種類に応じて `*_macOS_x64.dmg` または `*_macOS_arm64.dmg` をダウンロード
    - アプリケーションフォルダにドラッグし、まだ起動しないでください
    - ターミナルを開き、`sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` と入力して Enter を押してください
    - システムパスワードを入力し、ターミナルを閉じると、通常通り起動できます
    </details>
  - <details>
    <summary>Linux:</summary>
    - CPU の種類に応じて `*_Linux_x64.AppImage` または `*_Linux_arm64.AppImage` をダウンロード
    - `chmod +x LinguaGacha*.AppImage` で実行権限を付与
    - `./LinguaGacha*.AppImage` を実行
    </details>
- [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN) ] など、信頼できる AI モデル API を用意してください
- アプリを起動してプロジェクトを作成し、`翻訳するファイル` を `AGENT` の入力欄にドラッグして Enter を押してください！

## 使い方チュートリアル 📝
- **はじめに**
  - [基本チュートリアル](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 手順に沿って学べる、初心者必読のチュートリアル`
  - [モデル管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)　　[対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)　　[よくある質問](https://github.com/neavo/LinguaGacha/wiki/FAQEN)
- **機能**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[校正](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)　　[用語集](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[テキスト保護](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[テキスト置換](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [カスタムプロンプト](https://github.com/neavo/LinguaGacha/wiki/CustomPromptEN)　　[ラボ](https://github.com/neavo/LinguaGacha/wiki/LaboratoryEN)　　[機能設定](https://github.com/neavo/LinguaGacha/wiki/SettingsEN)　　[MTool オプティマイザー](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[コマンドラインモード](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)　　[高度な機能](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeaturesEN)
- **ベストプラクティス**
  - [音声・動画の高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/MediaEN)
  - [Godot ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [RenPy ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Tyrano ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)
  - [WOLFRPG ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [RPGMAKER ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- 各機能の詳しい説明は [Wiki](https://github.com/neavo/LinguaGacha/wiki) をご覧ください

## 最近の更新 📅
- 20261113 v0.141.2
  - `音声・動画`の翻訳機能を改善 [1095](../../issues/1092)
  - 修正と改善 [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - `音声・動画`の翻訳機能を改善 [#1092](../../issues/1092)
  - 修正と改善 [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - `音声（ASMR）`の翻訳に対応 [#1085](../../pull/1085)
  - `動画`の翻訳に対応 [#1085](../../pull/1085)
  - 修正と改善 [#1083](../../issues/1083) [#1084](../../issues/1084)

## 開発ガイド 🛠️
- [Go](https://go.dev) と [`Node.js`](https://nodejs.org) をインストール
- 依存関係のインストール: `npm install`
- 依存関係の更新: `npm ci`
- アプリの実行: `npm run dev`
- リリースのビルド: `npm run build`
- PRを提出する前に、変更範囲に応じて [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) の対応する検証を実行してください
- 非開発者の方は [リリースページ](https://github.com/neavo/LinguaGacha/releases) からビルド済みバージョンをダウンロードすることをお勧めします

## サポート 😥
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
- グループに参加して、ディスカッションやフィードバックもできます。
  - Discord - https://discord.gg/pyMRBGse75
