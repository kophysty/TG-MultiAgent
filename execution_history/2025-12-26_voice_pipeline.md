# Sprint: Voice pipeline v1 (download, ffmpeg, Whisper STT, AI draft)

Date: 2025-12-26

## Goal

Enable end-to-end processing of Telegram voice messages: download voice, convert to WAV, transcribe via OpenAI Whisper, then feed the transcript into the existing question/task AI flow with confirmation.

## Scope

- In scope:
  - Telegram voice handling (`msg.voice.file_id`)
  - Download OGG/OPUS to a temp file
  - Convert to `wav 16kHz mono PCM` via ffmpeg
  - Transcribe via OpenAI Whisper (`/v1/audio/transcriptions`)
  - Use existing AI intent parser for question vs task
  - Show progressive statuses via `editMessageText`
  - Remove PMD step from manual add flow and avoid sending removed DB props
- Out of scope:
  - Tool Registry and orchestrator layer
  - Persistent job queue and background worker
  - Streaming transcription

## Key decisions

- Decision: Implement voice flow inside current bot first, but keep conversion and STT as separate modules
  - Rationale: Fast MVP without upfront architecture, but leaves a clean seam to turn it into a tool later.

- Decision: Use `ffmpeg-static` locally
  - Rationale: Avoid system-level ffmpeg requirements for development on Windows.

## Changes implemented

- Voice pipeline:
  - Download voice file by `file_id`
  - Convert OGG/OPUS to WAV 16k mono
  - Transcribe with OpenAI Whisper
  - Feed transcript into the existing AI flow and show the same confirm/cancel UX
- UX:
  - One status message updated through pipeline stages
- Notion:
  - `createTask` now sends only properties that exist in the DB schema (cached)
  - Manual flow no longer asks for PMD

## Files changed (high signal)

- `core/dialogs/todo_bot.js`
  - Voice handler + status updates
  - Removed PMD step from manual add flow

- `core/connectors/telegram/files.js`
  - Download Telegram voice to a temp file

- `core/connectors/stt/ffmpeg.js`
  - OGG to WAV conversion via ffmpeg-static

- `core/connectors/stt/openai_whisper.js`
  - Whisper transcription via OpenAI API

- `core/connectors/notion/tasks_repo.js`
  - Dynamic properties based on DB schema

- `docs/current/voice.md`
  - Documentation of current voice flow

## Validation

- Steps:
  - Start bot with AI enabled:
    - `cd apps/todo_bot`
    - `TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1-mini npm start`
  - Send a Telegram voice message to the bot.
  - Observe status message updates and final task/question output.
- Expected result:
  - Status message goes through steps (download, ffmpeg, STT, parse).
  - For task: bot shows summary + confirm/cancel.
  - Confirm creates a Notion task.

## Follow-ups

- Add timeouts and cleanup guarantees for temp files.
- Optionally move STT to a worker (non-blocking) once we introduce a job queue.


