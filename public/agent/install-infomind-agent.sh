#!/usr/bin/env bash
set -euo pipefail

INFOMIND_BASE_URL="${INFOMIND_BASE_URL:-http://127.0.0.1:3456}"
INFOMIND_BASE_URL="${INFOMIND_BASE_URL%/}"
INFOMIND_AGENT="${INFOMIND_AGENT:-auto}"

installed=0

log() {
  printf '%s\n' "$*"
}

sed_escape() {
  printf '%s' "$1" | sed 's/[#&\\]/\\&/g'
}

expand_path() {
  local raw="$1"
  case "$raw" in
    "~")
      printf '%s\n' "$HOME"
      ;;
    "~/"*)
      printf '%s/%s\n' "$HOME" "${raw:2}"
      ;;
    *)
      printf '%s\n' "$raw"
      ;;
  esac
}

resolve_skill_dir() {
  local root="$1"
  local name
  name="$(basename "$root")"
  if [[ "$name" == "infomind" || "$name" == "InfoMind" ]]; then
    printf '%s\n' "$root"
  else
    printf '%s\n' "$root/infomind"
  fi
}

replace_base_url() {
  local file="$1"
  local escaped
  escaped="$(sed_escape "$INFOMIND_BASE_URL")"
  sed -i.bak "s#__INFOMIND_BASE_URL__#$escaped#g" "$file"
  rm -f "$file.bak"
}

write_skill_file() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<'SKILL'
---
name: infomind
description: InfoMind personal knowledge base integration. Save links, search saved knowledge, inspect books, and provide real content back to InfoMind for article mind maps.
---

# InfoMind Agent Skill

InfoMind API:

```text
__INFOMIND_BASE_URL__
```

Use this skill when the user wants to save a URL, search previously saved content, inspect their bookshelf, or generate an article mind map.

## Save Links

When a message contains a URL and collection intent, save it immediately.

Collection intent includes:

- Chinese: 收录, 收藏, 保存, 记录, 记一下, 存一下, 加入书架, 稍后看
- English: save, collect, bookmark, remember, read later, add to knowledge base

```bash
curl -s -X POST "__INFOMIND_BASE_URL__/api/entries" \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","note":"<optional note>"}'
```

If there are multiple URLs, save them one by one. If InfoMind reports that the URL already exists, tell the user it is already in the knowledge base.

### Douyin Mobile Links

For Douyin URLs (`douyin.com`, `v.douyin.com`, `iesdouyin.com`), do not call `/api/entries` first. Douyin needs the user's logged-in Chrome session. Create a browser capture job:

```bash
curl -s -X POST "__INFOMIND_BASE_URL__/api/capture-jobs" \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","platform":"douyin","source_channel":"feishu","source_message":"<original visible message>"}'
```

Reply according to the job status:

- `queued`, `opening`, `capturing`: 已收到，正在让 Mac 上的 InfoMind Clipper 用浏览器登录态采集。
- `saved`: 已收录。
- `needs_login`: 需要先在 Mac Chrome 登录抖音，然后重试。
- `failed` or `needs_user_action`: 采集失败或需要手动打开页面处理。

## Search

```bash
curl -s "__INFOMIND_BASE_URL__/api/entries/search?q=<keyword>&limit=10"
```

Summarize title, author, category, and URL.

## Bookshelf

```bash
curl -s "__INFOMIND_BASE_URL__/api/books?limit=20"
curl -s "__INFOMIND_BASE_URL__/api/books/<book_id>"
curl -s "__INFOMIND_BASE_URL__/api/stats"
```

## Deep Capture for Mind Maps

InfoMind should not generate a mind map from title and cover only. When an entry needs more content, the Agent should extract real content from the original source and write it back.

Check analysis:

```bash
curl -s "__INFOMIND_BASE_URL__/api/entries/<entry_id>/analysis"
```

Write article/post text:

```bash
curl -s -X PUT "__INFOMIND_BASE_URL__/api/entries/<entry_id>/content" \
  -H "Content-Type: application/json" \
  -d '{"full_text":"<real article or post body>","content_source":"agent"}'
```

Write transcript:

```bash
curl -s -X PUT "__INFOMIND_BASE_URL__/api/entries/<entry_id>/content" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"<caption or transcript text>","content_source":"agent-transcript"}'
```

Trigger analysis:

```bash
curl -s -X POST "__INFOMIND_BASE_URL__/api/entries/<entry_id>/analyze" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

For Bilibili/YouTube without captions, use InfoMind transcription:

```bash
curl -s -X POST "__INFOMIND_BASE_URL__/api/entries/<entry_id>/transcribe" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

Do not paste long transcripts into chat. Write them to InfoMind and let InfoMind run chunked analysis.
SKILL
  replace_base_url "$file"
}

install_hermes() {
  local hermes_home
  hermes_home="$(expand_path "${HERMES_HOME:-$HOME/.hermes}")"
  local skill_dir="$hermes_home/skills/infomind"
  local env_file="$hermes_home/.env"
  write_skill_file "$skill_dir/SKILL.md"
  mkdir -p "$hermes_home"
  touch "$env_file"
  if grep -q '^INFOMIND_BASE_URL=' "$env_file"; then
    local escaped
    escaped="$(sed_escape "$INFOMIND_BASE_URL")"
    sed -i.bak "s#^INFOMIND_BASE_URL=.*#INFOMIND_BASE_URL=$escaped#" "$env_file"
    rm -f "$env_file.bak"
  else
    printf '\nINFOMIND_BASE_URL=%s\n' "$INFOMIND_BASE_URL" >> "$env_file"
  fi
  log "Installed Hermes skill: $skill_dir/SKILL.md"
  installed=1
}

install_openclaw() {
  local openclaw_home
  openclaw_home="$(expand_path "${OPENCLAW_HOME:-$HOME/.openclaw}")"
  local skill_dir="$openclaw_home/skills/infomind"
  write_skill_file "$skill_dir/SKILL.md"
  log "Installed OpenClaw skill: $skill_dir/SKILL.md"
  installed=1
}

install_generic() {
  local root
  root="$(expand_path "${AGENT_SKILL_DIR:-$HOME/.infomind-agent/skills}")"
  local skill_dir
  skill_dir="$(resolve_skill_dir "$root")"
  write_skill_file "$skill_dir/SKILL.md"
  cat > "$skill_dir/infomind.env" <<ENV
INFOMIND_BASE_URL=$INFOMIND_BASE_URL
ENV
  log "Installed generic markdown skill: $skill_dir/SKILL.md"
  log "Environment file: $skill_dir/infomind.env"
  installed=1
}

case "$INFOMIND_AGENT" in
  hermes)
    install_hermes
    ;;
  openclaw)
    install_openclaw
    ;;
  generic|markdown|custom)
    install_generic
    ;;
  auto)
    if [[ -n "${AGENT_SKILL_DIR:-}" ]]; then
      install_generic
    fi
    if [[ -d "${HERMES_HOME:-$HOME/.hermes}" || -n "$(command -v hermes || true)" ]]; then
      install_hermes
    fi
    if [[ -d "${OPENCLAW_HOME:-$HOME/.openclaw}" || -n "$(command -v openclaw || true)" ]]; then
      install_openclaw
    fi
    if [[ "$installed" -eq 0 ]]; then
      install_generic
    fi
    ;;
  *)
    log "Unknown INFOMIND_AGENT=$INFOMIND_AGENT" >&2
    log "Use auto, hermes, openclaw, or generic." >&2
    exit 1
    ;;
esac

log "Configured InfoMind API: $INFOMIND_BASE_URL"

if command -v curl >/dev/null 2>&1; then
  if curl -fsS "$INFOMIND_BASE_URL/api/health" >/dev/null 2>&1; then
    log "InfoMind API health check: ok"
  else
    log "InfoMind API health check failed. Make sure this machine can reach $INFOMIND_BASE_URL" >&2
  fi
fi

log "Done. Restart or reload your Agent so it picks up the InfoMind skill."
