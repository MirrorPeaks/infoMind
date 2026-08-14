#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="$ROOT_DIR/data/models"
MODEL_PATH="$MODEL_DIR/ggml-base.bin"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

echo "InfoMind STT setup"
echo "Project: $ROOT_DIR"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install ffmpeg and whisper.cpp on macOS."
  echo "Install Homebrew first: https://brew.sh"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Installing ffmpeg..."
  brew install ffmpeg
else
  echo "ffmpeg already installed."
fi

if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper >/dev/null 2>&1; then
  echo "Installing whisper.cpp..."
  brew install whisper-cpp
else
  echo "whisper.cpp already installed."
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "Installing yt-dlp..."
  brew install yt-dlp
else
  echo "Updating yt-dlp..."
  brew upgrade yt-dlp || true
fi

mkdir -p "$MODEL_DIR"
if [ ! -f "$MODEL_PATH" ]; then
  echo "Downloading Whisper base model..."
  curl -L "$WHISPER_MODEL_URL" -o "$MODEL_PATH"
else
  echo "Whisper base model already exists: $MODEL_PATH"
fi

echo
echo "STT setup complete."
echo "Restart InfoMind, then click 重新查找字幕/转写."
