<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>All-in-One-Übersetzungs-AGENT Harness · Comics Spiele Audio & Video E-Books · Ein Klick · Hohe Qualität · Alle Formate</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## Überblick 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), ein auf Übersetzung spezialisiertes `AGENT Harness` der nächsten Generation
- `Ein Klick - Datei hineinziehen, auf Start klicken und auf die fertige Übersetzung warten`
  - Vollautomatische Übersetzung zwischen verschiedenen Sprachen per Knopfdruck
  - Keine technischen Vorkenntnisse und keine Fremdsprachenkenntnisse nötig
- `Hohe Qualität - Freie Ausgabe ohne Einschränkungen`
  - Erstellt automatisch ein Glossar für durchgehend einheitliche Eigennamen
  - Erhält Formatierung und Stile in `Comics`, `Spielen` und `Audio & Video` vollständig
  - Semantisches Smart-Lektorat: Einfach das Problem benennen, und `AGENT` korrigiert die Übersetzung automatisch und verfeinert ihren Stil
- `Alle Formate - Alles lässt sich übersetzen, zum Beispiel`
  - Bilder & Comics - `Manga`, `US-Comics`, `Schwarz-Weiß`, `Farbe`, `horizontaler Text` und `vertikaler Text`
  - Audio & Video - `ASMR`, `Anime`, `Filme & Serien`, `Motion Comics` und mehr
  - Untertitel & E-Books - `.txt`, `.md`, `.epub`, `.pdf`, `.srt`, `.ass`, `.ssa`, `.vtt`, `.lrc` und weitere Formate
  - Game-Engines & Datendateien - `Godot`, `ACTION GAME MAKER`, `RenPy`, `Tyrano`, `WOLFRPG`, `RPGMAKER`, `KV-JSON`, `Message-JSON` und mehr

> <img width="1600" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="1600" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

> [!IMPORTANT]
> - Wenn Sie ein mit [LinguaGacha](https://github.com/neavo/LinguaGacha) übersetztes Werk veröffentlichen, müssen Sie [LinguaGacha](https://github.com/neavo/LinguaGacha) an gut sichtbarer Stelle nennen!
> - Der Autor behält sich alle Rechte vor. Der Quellcode dient ausschließlich der Veranschaulichung. Integration, Änderung, Verbreitung, Weiterverkauf und Weiterentwicklung sind in jeder Form untersagt!

## Ergebnis-Vorschau ✨
<table>
  <tbody>
    <tr><td><details open><summary><b>🗯️ Comics und Bilder · Automatischer Textsatz</b></summary><br><img width="1280" alt="Bilder" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/image.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎬 Video · Zeilengenaue Zeitachsen-Synchronisation</b></summary><br><img width="1280" alt="Video" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎧 Audio · Untertitel- &amp; Spektrum-Video-Doppelausgabe</b></summary><br><img width="1280" alt="Audio" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎮 Spiele · Vollautomatische Spielübersetzung ohne technische Vorkenntnisse</b></summary><br><img width="1280" alt="Spiele" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/game.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>📚 E-Books · Unterstützung für PDF/EPUB/Markdown</b></summary><br><img width="1280" alt="E-Books" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/book.png" /></details></td></tr>
  </tbody>
</table>

## Erste Schritte 🛸
- Laden Sie die Anwendung von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter
  - Windows:
    - Laden Sie je nach CPU-Typ `*_Windows_x64.zip` oder `*_Windows_arm64.zip` herunter
    - Entpacken Sie das Archiv und starten Sie die Anwendung per Doppelklick auf `app.exe`
  - <details>
    <summary>macOS:</summary>
    - Laden Sie je nach CPU-Typ `*_macOS_x64.dmg` oder `*_macOS_arm64.dmg` herunter
    - Ziehen Sie die Anwendung in den Programme-Ordner, starten Sie sie aber noch nicht
    - Öffnen Sie das Terminal, geben Sie `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` ein und drücken Sie die Eingabetaste
    - Geben Sie Ihr Systempasswort ein und schließen Sie das Terminal. Sie können die Anwendung jetzt normal starten
    </details>
  - <details>
    <summary>Linux:</summary>
    - Laden Sie je nach CPU-Typ `*_Linux_x64.AppImage` oder `*_Linux_arm64.AppImage` herunter
    - Erteilen Sie mit `chmod +x LinguaGacha*.AppImage` die Ausführungsberechtigung
    - Führen Sie `./LinguaGacha*.AppImage` aus
    </details>
- Besorgen Sie sich Zugang zu einer zuverlässigen KI-Modellschnittstelle, zum Beispiel [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]
- Starten Sie die Anwendung, erstellen Sie ein Projekt, ziehen Sie die `zu übersetzenden Dateien` in das `AGENT`-Eingabefeld und drücken Sie die Eingabetaste!

## Anleitungen 📝
- **Einstieg**
  - [Grundlagen-Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 Schritt für Schritt erklärt, für Einsteiger empfohlen`
  - [Modellverwaltung](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[Unterstützte Dateiformate](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[FAQ](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **Funktionen**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[Korrekturlesen](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[Glossar](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[Textschutz](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[Textersetzung](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [Benutzerdefinierte Prompts](https://github.com/neavo/LinguaGacha/wiki/CustomPrompt)　　[Labor](https://github.com/neavo/LinguaGacha/wiki/Laboratory)　　[Funktionseinstellungen](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[MTool-Optimierer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[Befehlszeilenmodus](https://github.com/neavo/LinguaGacha/wiki/CLIMode)　　[Erweiterte Funktionen](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **Bewährte Vorgehensweisen**
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Audio und Videos](https://github.com/neavo/LinguaGacha/wiki/Media)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Comics und Bildern](https://github.com/neavo/LinguaGacha/wiki/Image)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Godot-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RenPy-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Tyrano-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von WOLFRPG-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RPGMAKER-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- Ausführlichere Informationen zu den Funktionen finden Sie im [Wiki](https://github.com/neavo/LinguaGacha/wiki)

## Neueste Updates 📅
- 20261120 v0.142.2
  - Übersetzung transparenter `Bilder` hinzugefügt [#1120](../../pull/1120)
  - Textsatz bei der Übersetzung von `Bildern (Comics)` deutlich verbessert [#1116](../../pull/1116)
  - Fehlerbehebungen und Verbesserungen [#1117](../../issues/1117) [#1118](../../issues/1118) [#1119](../../issues/1119)

- 20261119 v0.142.1
  - Übersetzung von `Bildern (Comics)` hinzugefügt [#1109](../../pull/1109)
  - Fehlerbehebungen und Verbesserungen [#1111](../../issues/1111) [#1112](../../issues/1112)

## Probleme melden 😥
- Laufzeitprotokolle werden unter anderem im Ordner `log` im Stammverzeichnis der Anwendung gespeichert
- Fügen Sie diese Protokolldateien bitte Ihrer Fehlermeldung bei
- Sie können auch unseren Gruppen beitreten, um sich auszutauschen und Feedback zu geben
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
