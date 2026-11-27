<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>万能翻訳 AGENT Harness · ワンクリック · 高品質 · 全形式</p>
<p align='center'>漫画 ゲーム 音声・動画 電子書籍 · PDF EPUB ASMR MANGA COMIC RPGGAME GALGAME</p>

&ensp;
&ensp;

## 🌍 README
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 📢 概要
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、翻訳に特化した次世代の `AGENT Harness`
- `ワンクリック`
  - 多言語間の全自動ワンクリック相互翻訳
  - 人の手を介さずに全自動で翻訳・校正
- `高品質`
  - 制限なく自由に出力
  - コンテンツの種類ごとに細かく調整し、最適な翻訳品質を実現
  - スマートな用語管理と校正で、簡単な対話を通じて好みの文体や言い回しに調整
- `全形式（以下は対応例の一部）`
  - 音声・動画 - `ASMR` `アニメ` `映画・ドラマ` `モーションコミック`
  - 画像・漫画 - `日本の漫画` `アメコミ` `白黒` `カラー` `横書き` `縦書き`
  - 字幕・電子書籍 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc`
  - ゲーム・データファイル - `MTool` `Godot` `RenPy` `Tyrano` `Kirikiri` `Galgame` `WOLFRPG` `RPGMAKER` `SRPG Studio`

> <img width="1600" alt="ライトテーマ" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/light.jpg" />

> <img width="1600" alt="ダークテーマ" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/dark.jpg" />

> [!IMPORTANT]
> - [LinguaGacha](https://github.com/neavo/LinguaGacha) で翻訳した作品を公開する際は、目立つ場所に必ず [LinguaGacha](https://github.com/neavo/LinguaGacha) を明記してください！
> - 作者はすべての権利を留保します。ソースコードは閲覧用としてのみ公開しており、いかなる形での組み込み、改変、配布、転売、二次開発も禁止します！

## ✨ 翻訳サンプル（全自動翻訳、人の手を介さずに作成）
<table>
  <tbody>
    <tr><td><details open><summary><b>🗯️ 漫画</b></summary><br><img width="1280" alt="画像" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/image.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎬 動画</b></summary><br><img width="1280" alt="動画" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎧 音声</b></summary><br><img width="1280" alt="音声" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎮 ゲーム</b></summary><br><img width="1280" alt="ゲーム" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/game.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>📚 電子書籍</b></summary><br><img width="1280" alt="電子書籍" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/book.png" /></details></td></tr>
  </tbody>
</table>

## 🛸 ワークフロー
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

## 📝 使い方チュートリアル
- **はじめに**
  - [基本チュートリアル](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 手順に沿って学べる、初心者必読のチュートリアル`
  - [モデル管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)　　[対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)
- **機能**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[校正](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)　　[用語集](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[テキスト保護](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[テキスト置換](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [カスタムプロンプト](https://github.com/neavo/LinguaGacha/wiki/CustomPromptEN)　　[ラボ](https://github.com/neavo/LinguaGacha/wiki/LaboratoryEN)　　[機能設定](https://github.com/neavo/LinguaGacha/wiki/SettingsEN)　　[MTool オプティマイザー](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[コマンドラインモード](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)　　[高度な機能](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeaturesEN)
- **ベストプラクティス**
  - [音声・動画の高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/MediaEN)
  - [漫画・画像の高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/ImageEN)
  - [Godot ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [RenPy ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Tyrano ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)
  - [WOLFRPG ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [RPGMAKER ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- 各機能の詳しい説明は [Wiki](https://github.com/neavo/LinguaGacha/wiki) をご覧ください

## 📅 最近の更新
- 20261127 v0.143.1
  - 形式スキル `SRPG Studio` を追加しました [#1139](../../issues/1139)
  - 修正と改善 [#1136](../../issues/1136) [#1137](../../issues/1137) [#1138](../../issues/1138) [#1140](../../issues/1140) [#1141](../../issues/1141) [#1142](../../issues/1142)

- 20261126 v0.143.0
  - 複数のプロジェクトを同時に開けるようになりました [#1127](../../issues/1127)
  - 漫画（画像）の翻訳品質を改善しました [#1130](../../issues/1130)
  - 修正と改善 [#1131](../../issues/1131) [#1132](../../issues/1132) [#1133](../../issues/1133) [#1134](../../issues/1134)

## ❓ よくある質問

- `AGENT` を使わずに翻訳できますか\
  テキストや字幕などの標準対応形式は、`ワークベンチ` やコマンドラインで一括翻訳できます。 [手順を見る](https://github.com/neavo/LinguaGacha/wiki/FAQEN#-can-i-translate-without-agent)

- ゲームやファイルの更新後も、既存の訳文を保持できますか\
  元のプロジェクトで `AGENT` の `ファイルを更新` を使うと、翻訳済みの訳文を保持し、追加・変更された内容だけを翻訳できます。 [手順を見る](https://github.com/neavo/LinguaGacha/wiki/FAQEN#-can-i-keep-existing-translations-after-a-game-or-file-update)

## 😥 サポート
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
- グループに参加して、ディスカッションやフィードバックもできます。
  - Discord - https://discord.gg/pyMRBGse75
