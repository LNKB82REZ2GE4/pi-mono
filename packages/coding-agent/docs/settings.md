# Settings

Pi uses JSON settings files with project settings overriding global settings.

| Location | Scope |
|----------|-------|
| `~/.pi/agent/settings.json` | Global (all projects) |
| `.pi/settings.json` | Project (current directory) |

Edit directly or use `/settings` for common options.

## All Settings

### Model & Thinking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | - | Default provider (e.g., `"anthropic"`, `"openai"`) |
| `defaultModel` | string | - | Default model ID |
| `defaultThinkingLevel` | string | - | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output |
| `thinkingBudgets` | object | - | Custom token budgets per thinking level |

#### thinkingBudgets

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

### UI & Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | Theme name (`"dark"`, `"light"`, or custom) |
| `quietStartup` | boolean | `false` | Hide startup header |
| `collapseChangelog` | boolean | `false` | Show condensed changelog after updates |
| `doubleEscapeAction` | string | `"tree"` | Action for double-escape: `"tree"`, `"fork"`, or `"none"` |
| `editorPaddingX` | number | `0` | Horizontal padding for input editor (0-3) |
| `autocompleteMaxVisible` | number | `5` | Max visible items in autocomplete dropdown (3-20) |
| `showHardwareCursor` | boolean | `false` | Show terminal cursor |

### Compaction

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `compaction.enabled` | boolean | `true` | Enable auto-compaction |
| `compaction.reserveTokens` | number | `16384` | Tokens reserved for LLM response |
| `compaction.keepRecentTokens` | number | `20000` | Recent tokens to keep (not summarized) |

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### Branch Summary

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `branchSummary.reserveTokens` | number | `16384` | Tokens reserved for branch summarization |

### Retry

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | Enable automatic retry on transient errors |
| `retry.maxRetries` | number | `3` | Maximum retry attempts |
| `retry.baseDelayMs` | number | `2000` | Base delay for exponential backoff (2s, 4s, 8s) |
| `retry.maxDelayMs` | number | `60000` | Max server-requested delay before failing (60s) |

When a provider requests a retry delay longer than `maxDelayMs` (e.g., Google's "quota will reset after 5h"), the request fails immediately with an informative error instead of waiting silently. Set to `0` to disable the cap.

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "maxDelayMs": 60000
  }
}
```

### Message Delivery

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `steeringMode` | string | `"one-at-a-time"` | How steering messages are sent: `"all"` or `"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | How follow-up messages are sent: `"all"` or `"one-at-a-time"` |
| `transport` | string | `"sse"` | Preferred transport for providers that support multiple transports: `"sse"`, `"websocket"`, or `"auto"` |

### Terminal & Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | Show images in terminal (if supported) |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when content shrinks (can cause flicker) |
| `images.autoResize` | boolean | `true` | Resize images to 2000x2000 max |
| `images.blockImages` | boolean | `false` | Block all images from being sent to LLM |

### Shell

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shellPath` | string | - | Custom shell path (e.g., for Cygwin on Windows) |
| `shellCommandPrefix` | string | - | Prefix for every bash command (e.g., `"shopt -s expand_aliases"`) |

### Model Cycling

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabledModels` | string[] | - | Model patterns for Ctrl+P cycling (same format as `--models` CLI flag) |

```json
{
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"]
}
```

### Markdown

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `markdown.codeBlockIndent` | string | `"  "` | Indentation for code blocks |

### Memory (Experimental)

Enable built-in long-term memory for coding-agent sessions.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `memory.enabled` | boolean | `false` | Enable built-in memory commands, retrieval, and review queue |
| `memory.storeDir` | string | `~/.pi/agent/memory` | Memory storage location |
| `memory.autoReindexOnStart` | boolean | `true` | Reindex Markdown memories on startup |
| `memory.autoImportSessions` | boolean | `true` | Incrementally import session history as memory candidates |
| `memory.autoCapture.enabled` | boolean | `true` | Auto-capture memory candidates from turns |
| `memory.autoCapture.maxCandidatesPerTurn` | number | `8` | Candidate cap per turn |
| `memory.retrieval.topK` | number | `6` | Max retrieved memories per prompt |
| `memory.retrieval.maxInjectedTokens` | number | `1200` | Max memory tokens injected per prompt |
| `memory.retrieval.includeUnreviewed` | boolean | `false` | Include unreviewed candidates in retrieval |
| `memory.embedding.provider` | `"ollama" \| "hash"` | `"ollama"` | Embedding backend |
| `memory.embedding.model` | string | `"nomic-embed-text"` | Embedding model ID |
| `memory.embedding.endpoint` | string | `"http://127.0.0.1:11434"` | Ollama endpoint |
| `memory.embedding.dimensions` | number | `384` | Hash embedding vector size |
| `memory.embedding.gpuDevice` | string | `"0"` | Preferred embedding GPU ID (for local runtime setup) |
| `memory.embedding.maxVramMb` | number | `2560` | Embedding VRAM budget hint |
| `memory.manager.provider` | `"ollama" \| "heuristic"` | `"ollama"` | Candidate extraction/summarization backend |
| `memory.manager.model` | string | `"qwen2.5:3b-instruct"` | Local manager model |
| `memory.manager.endpoint` | string | `"http://127.0.0.1:11434"` | Ollama endpoint |
| `memory.manager.gpuDevice` | string | `"0"` | Preferred manager GPU ID |
| `memory.memAgent.enabled` | boolean | `true` | Enable mem-agent LLM for intelligent curation and housekeeping |
| `memory.memAgent.model` | string | `"mem-agent-Q8_0"` | Mem-agent model name (GGUF path or Ollama model) |
| `memory.memAgent.endpoint` | string | `"http://127.0.0.1:8765"` | Mem-agent LLM endpoint (llama.cpp server) |
| `memory.memAgent.provider` | `"ollama" \| "llamacpp"` | `"llamacpp"` | Mem-agent backend provider |
| `memory.memAgent.gpuDevice` | string | `"1"` | Preferred mem-agent GPU ID |
| `memory.memAgent.maxTokens` | number | `16384` | Max generation tokens (thinking models need 16K+) |
| `memory.memAgent.temperature` | number | `0.1` | Mem-agent sampling temperature (low for consistency) |
| `memory.encryption.mode` | `"off" \| "on" \| "auto"` | `"auto"` | Encrypt derived index files when key is available |

> Markdown memory files remain human-editable plaintext by design. Encryption applies to derived index files under `.index/` when enabled.

### TTS (Text-to-Speech)

Pi can announce agent responses aloud using F5-TTS voice cloning. Requires the
TTS Docker service running on port 5052 (see the just-talk project), or the
`tts-clone` CLI installed at `~/.local/bin/tts-clone`. Falls back gracefully
if neither is available.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `tts.enabled` | boolean | `false` | Enable TTS announcements |
| `tts.defaultVoice` | string | `"default"` | Voice profile name to use by default |
| `tts.speed` | number | `1.0` | Speech rate multiplier |
| `tts.maxLength` | number | `500` | Max characters to speak per announcement |
| `tts.events.turnEnd` | boolean | `true` | Speak after each assistant turn |
| `tts.events.agentEnd` | boolean | `true` | Speak when the agent session ends |
| `tts.voices` | object | - | Named voice profiles (see below) |
| `tts.agentVoices` | object | - | Map model IDs to voice names (see below) |

#### Voice profiles

Each named profile specifies a reference audio file and its transcript.
Record 10-15 seconds of clean speech and save as WAV.

```json
{
  "tts": {
    "enabled": true,
    "defaultVoice": "assistant",
    "voices": {
      "assistant": {
        "ref": "~/.pi/voices/assistant.wav",
        "refText": "Some call me nature, others call me mother nature.",
        "description": "Default assistant voice"
      },
      "builder": {
        "ref": "~/.pi/voices/builder.wav",
        "refText": "I build things one step at a time.",
        "description": "Voice for builder agent"
      }
    }
  }
}
```

#### Per-agent voices

When running multiple pi instances in parallel, each instance can use a
different voice so you can tell them apart.

**Option 1 — CLI flag** (most flexible):

```bash
# Instance A
pi --tts-voice assistant

# Instance B
pi --tts-voice builder
```

**Option 2 — Environment variable**:

```bash
PI_TTS_VOICE=builder pi
```

**Option 3 — Model-based routing** (`agentVoices` maps model ID → voice name):

```json
{
  "tts": {
    "agentVoices": {
      "claude-opus-4-5": "assistant",
      "claude-haiku-3-5": "builder"
    }
  }
}
```

Voice resolution order: `--tts-voice` flag > `PI_TTS_VOICE` env var >
`agentVoices[model.id]` > `defaultVoice`.

#### What gets spoken

Pi speaks the full text of each assistant response, minus:
- Fenced and indented code blocks
- Inline code
- Markdown formatting (headers, bold, italic, links)
- Bare URLs

The result is truncated at `tts.maxLength` characters, preferring a
sentence boundary for a natural cut-off.

Use `/tts test` to hear the current voice, `/tts voices` to list configured
voices, `/tts set <name>` to switch voice for the current session, or
`/tts <text>` to speak arbitrary text.

### Resources

These settings define where to load extensions, skills, prompts, and themes from.

Paths in `~/.pi/agent/settings.json` resolve relative to `~/.pi/agent`. Paths in `.pi/settings.json` resolve relative to `.pi`. Absolute paths and `~` are supported.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `packages` | array | `[]` | npm/git packages to load resources from |
| `extensions` | string[] | `[]` | Local extension file paths or directories |
| `skills` | string[] | `[]` | Local skill file paths or directories |
| `prompts` | string[] | `[]` | Local prompt template paths or directories |
| `themes` | string[] | `[]` | Local theme file paths or directories |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands |

Arrays support glob patterns and exclusions. Use `!pattern` to exclude. Use `+path` to force-include an exact path and `-path` to force-exclude an exact path.

#### packages

String form loads all resources from a package:

```json
{
  "packages": ["pi-skills", "@org/my-extension"]
}
```

Object form filters which resources to load:

```json
{
  "packages": [
    {
      "source": "pi-skills",
      "skills": ["brave-search", "transcribe"],
      "extensions": []
    }
  ]
}
```

See [packages.md](packages.md) for package management details.

## Example

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "enabledModels": ["claude-*", "gpt-4o"],
  "packages": ["pi-skills"]
}
```

## Project Overrides

Project settings (`.pi/settings.json`) override global settings. Nested objects are merged:

```json
// ~/.pi/agent/settings.json (global)
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}

// .pi/settings.json (project)
{
  "compaction": { "reserveTokens": 8192 }
}

// Result
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 8192 }
}
```
