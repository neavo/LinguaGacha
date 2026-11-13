<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Ein KI-Übersetzer der nächsten Generation für Romane, Spiele, Untertitel, Audio und Video auf Knopfdruck</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## Überblick 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/) ist ein KI-gestützter Multi-Format-Übersetzer der nächsten Generation
- Sofort einsatzbereit, (fast) ohne Einrichtung: Leistungsstarke Funktionen brauchen keine komplizierten Einstellungen
- Übersetzt auf Knopfdruck zwischen 16 Sprachen, darunter `Chinesisch`, `Englisch`, `Japanisch`, `Koreanisch`, `Russisch`, `Deutsch`, `Französisch` und `Italienisch`
- Unterstützt `Untertitel`, `E-Books`, `Game Engines`, `Audio (ASMR)` und `Video (Motion Comics / Anime)`
- Unterstützt lokale und Online-Schnittstellen wie `OpenAI`, `Google`, `Anthropic` und `SakuraLLM`

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

> <img width="1280" alt="Beispiel für zweisprachige Untertitel bei Videos und Motion Comics" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" />

> <img width="1280" alt="Beispiel für zweisprachiges Audio-Spektrum-Video" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" />

## Besondere Hinweise ⚠️
- Wenn Sie [LinguaGacha](https://github.com/neavo/LinguaGacha) für Ihre Übersetzung verwenden, weisen Sie bitte an gut sichtbarer Stelle in den Werkangaben oder auf der Veröffentlichungsseite darauf hin!
- Wenn Ihr Projekt kommerzielle Aktivitäten oder Einnahmen umfasst, kontaktieren Sie bitte vor der Nutzung von [LinguaGacha](https://github.com/neavo/LinguaGacha) den Autor, um eine Genehmigung einzuholen!

## Vorteile 📌
- Beste Übersetzungsqualität und höchste Übersetzungsgeschwindigkeit
  - Erhält die Formatierung verschiedener `Untertitel` und `E-Books` vollständig
  - Erstellt automatisch ein Glossar, damit Eigennamen im gesamten Werk einheitlich übersetzt werden
  - Untertitel in zehn Sekunden, ein Roman in einer Minute, ein Spiel in fünf Minuten
- Integrierter `AGENT`-Modus, der verschiedene Aufgaben automatisch im Dialog erledigt　`👈👈 Exklusive Funktion`
  - Keine technischen Kenntnisse erforderlich: übersetzen und sofort spielen
  - Unterstützt alle gängigen Engines: `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`
  - **`Audio & Video (ASMR / Motion Comics) aus einer Hand`**: Lokale Spracherkennung + Erkennung von Bildschirmtexten; bei Videos werden zweisprachige `.ass`-Untertitel automatisch um Sprechblasen und Gesichter herum platziert, reine Audiodateien erhalten direkt ein zweisprachiges `1920×1080`-Spektrum-Video (`.mp4`)

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
- Besorgen Sie sich Zugang zu einer zuverlässigen KI-Modellschnittstelle. Empfehlung:
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ], keine Grafikkarte erforderlich
- Starten Sie die Anwendung, erstellen Sie ein Projekt, ziehen Sie `Dateien`, `Spielverzeichnis` oder `Audio/Video` in das `AGENT`-Eingabefeld und drücken Sie die Eingabetaste!

## Anleitungen 📝
- **Einstieg & Medien**
  - [Grundlagen-Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 Schritt für Schritt erklärt, für Einsteiger empfohlen`
  - [Unterstützte Dateiformate](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[Audio- & Videoübersetzung (ASMR / Motion Comics)](https://github.com/neavo/LinguaGacha/wiki/Media)　　[FAQ](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **Modelle & Einstellungen**
  - [Modellverwaltung](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[Funktionseinstellungen & Labor](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[Anwendungs-Proxy](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **Kernfunktionen**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[Korrekturlesen & Vorschau](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[Glossar](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[Textschutz](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)
  - [Textersetzung](https://github.com/neavo/LinguaGacha/wiki/Replacement)　　[MTool-Optimierer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[Befehlszeilenmodus](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
- **Engine-Praxis**
  - [Allgemeiner Spiel-Workflow & Schriftart-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGames): [Godot](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot) · [RenPy](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy) · [Tyrano](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano) · [WOLFRPG](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG) · [RPGMAKER](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
  - [Notizen zu Kirikiri-Spielen ohne komplexe Verschlüsselung (Community)](https://github.com/neavo/LinguaGacha/discussions/181)
- Ausführlichere Informationen finden Sie auf der [Wiki-Startseite](https://github.com/neavo/LinguaGacha/wiki)

## Unterstützte Formate 🏷️
| Typ | Format / Eingabe | Hinweise |
|:---|:---|:---|
| Audio (ASMR / Sprache) | Gängige Audioformate (inkl. Cover-Bild) | Ausgabe als `.ass` (einsprachig/zweisprachig) & zweisprachiges Spektrum-`.mp4` ([[Audio & Video](https://github.com/neavo/LinguaGacha/wiki/Media)]) |
| Video (Anime / Motion Comics) | Gängige Videoformate | Dialog-ASR + Bildschirmtext-Erkennung & smarte Untertitelplatzierung (`.ass`) ([[Audio & Video](https://github.com/neavo/LinguaGacha/wiki/Media)]) |
| Untertitel & Liedtexte | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | Erhält Zeitstempel und Formatierung |
| E-Books & Dokumente | `.txt` `.md` `.pdf` `.epub` | `.pdf` mit `AGENT`-Analyse und Seitenvergleichsvorschau |
| `KV-JSON` / `Message-JSON` | `.json` | Quelle: [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `Godot` / `ACTION GAME MAKER` | `.exe` oder Spielverzeichnis | Anleitung: [[Godot-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)] |
| `RenPy` | `.exe` oder Spielverzeichnis | Anleitung: [[RenPy-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)] |
| `Tyrano` | `.exe` oder Spielverzeichnis | Anleitung: [[Tyrano-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)] |
| `WOLFRPG` | `.exe` oder Spielverzeichnis | Anleitung: [[WOLFRPG-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)] |
| `RPGMAKER MV/MZ / XP/VX/VXAce` | `.exe` oder Spielverzeichnis | Anleitung: [[RPGMAKER-Leitfaden](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)] |
| `.rpy` `.xlsx` `.trans` | Ältere Formate | `👈 Unterstützung endet bald` — nativen Ordner-Import bevorzugen |
| Andere Dateien oder Spiele | Beliebig | In den `AGENT`-Arbeitsbereich ziehen zur automatischen Erkennung |

## Neueste Updates 📅
- 20261113 v0.141.2
  - Übersetzung von `Audio und Videos` verbessert [1095](../../issues/1092)
  - Fehlerbehebungen und Verbesserungen [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - Übersetzung von `Audio und Videos` verbessert [#1092](../../issues/1092)
  - Fehlerbehebungen und Verbesserungen [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - Übersetzung von `Audio (ASMR)` hinzugefügt [#1085](../../pull/1085)
  - Übersetzung von `Videos` hinzugefügt [#1085](../../pull/1085)
  - Fehlerbehebungen und Verbesserungen [#1083](../../issues/1083) [#1084](../../issues/1084)

## Entwicklung 🛠️
- Installieren Sie [Go](https://go.dev) und [`Node.js`](https://nodejs.org)
- Abhängigkeiten installieren: `npm install`
- Abhängigkeiten aktualisieren: `npm ci`
- Anwendung starten: `npm run dev`
- Release erstellen: `npm run build`
- Führen Sie vor dem Einreichen eines PR die zum Änderungsumfang passenden Prüfungen aus [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) aus
- Wenn Sie nicht selbst entwickeln möchten, laden Sie die fertige Version direkt von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter

## Probleme melden 😥
- Laufzeitprotokolle werden unter anderem im Ordner `log` im Stammverzeichnis der Anwendung gespeichert
- Fügen Sie diese Protokolldateien bitte Ihrer Fehlermeldung bei
- Sie können auch unseren Gruppen beitreten, um sich auszutauschen und Feedback zu geben
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
