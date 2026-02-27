/**
 * TTS Extension for pi coding agent.
 * Announces task completions and events using F5-TTS voice cloning.
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionFactory } from "../extensions/index.js";
import type { ResolvedTtsSettings, TtsVoiceProfile } from "./types.js";

const TTS_SERVER_URL = process.env.TTS_SERVER_URL ?? "http://localhost:5052";

function toTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const chunks: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const type = (item as { type?: string }).type;
		if (type === "text" && typeof (item as { text?: string }).text === "string") {
			chunks.push((item as { text: string }).text);
		}
		// Skip thinking blocks - we don't want to read internal reasoning
	}
	return chunks.join(" ");
}

function extractMessageText(message: AgentMessage): string | null {
	// Handle different message types
	if (!message || typeof message !== "object") {
		return null;
	}

	const role = (message as { role?: string }).role;

	// Standard assistant message with content
	if (role === "assistant" && "content" in message) {
		return toTextContent(message.content);
	}

	// User message with content
	if (role === "user" && "content" in message) {
		return toTextContent(message.content);
	}

	// Tool result message
	if (role === "toolResult" && "content" in message) {
		return toTextContent(message.content);
	}

	// Custom message
	if (role === "custom" && "content" in message) {
		return toTextContent(message.content);
	}

	// Bash execution - skip these
	if (role === "bashExecution") {
		return null;
	}

	return null;
}

function truncateText(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	// Truncate at a sentence boundary if possible
	const truncated = normalized.slice(0, maxLength - 3);
	const lastPeriod = truncated.lastIndexOf(".");
	if (lastPeriod > maxLength * 0.5) {
		return `${truncated.slice(0, lastPeriod + 1)}`;
	}
	return `${truncated}...`;
}

/**
 * Remove markdown formatting so the text reads naturally when spoken.
 * Code blocks and inline code are removed entirely (not spoken as "[code block]")
 * because they're not meaningful out loud.
 */
function stripMarkdownForSpeech(text: string): string {
	return (
		text
			// Remove fenced code blocks (language tag and body)
			.replace(/```[\s\S]*?```/g, "")
			// Remove indented code blocks (4-space or tab-indented lines)
			.replace(/^( {4}|\t).+$/gm, "")
			// Remove inline code
			.replace(/`[^`\n]+`/g, "")
			// Strip markdown headers
			.replace(/^#{1,6}\s+/gm, "")
			// Strip bold/italic (preserve inner text)
			.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
			.replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1")
			// Strip links (preserve display text)
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			// Strip bare URLs
			.replace(/https?:\/\/\S+/g, "")
			// Strip horizontal rules
			.replace(/^[-*_]{3,}\s*$/gm, "")
			// Collapse multiple blank lines to one
			.replace(/\n{3,}/g, "\n\n")
			// Normalize spaces within lines
			.replace(/[ \t]+/g, " ")
			.replace(/^ +/gm, "")
			.trim()
	);
}

function extractAnnouncementText(message: AgentMessage, maxLength: number): string | null {
	const text = extractMessageText(message);
	if (!text || !text.trim()) {
		return null;
	}

	const cleaned = stripMarkdownForSpeech(text);
	if (!cleaned) {
		return null;
	}

	return truncateText(cleaned, maxLength);
}

function playWav(path: string): Promise<void> {
	return new Promise((resolve) => {
		const player = spawn("paplay", [path], { stdio: "ignore" });
		player.on("close", () => resolve());
		player.on("error", () => {
			// Fallback: try ffplay
			const ffplay = spawn("ffplay", ["-nodisp", "-autoexit", path], { stdio: "ignore" });
			ffplay.on("close", () => resolve());
			ffplay.on("error", () => resolve()); // Give up silently
		});
	});
}

type ServerResult = "ok" | "error" | "unreachable";

/**
 * Fast path: send synthesis request to the persistent TTS server.
 *
 * Returns:
 *   "ok"          — synthesis succeeded, audio played
 *   "error"       — server responded (non-200) or timed out; GPU likely occupied
 *   "unreachable" — connection refused; server is not running
 */
async function speakViaServer(
	text: string,
	voice: TtsVoiceProfile,
	settings: ResolvedTtsSettings,
): Promise<ServerResult> {
	try {
		const resp = await fetch(`${TTS_SERVER_URL}/speak`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text,
				ref: voice.ref,
				ref_text: voice.refText,
				speed: settings.speed,
			}),
			signal: AbortSignal.timeout(60_000),
		});

		if (!resp.ok) {
			const body = await resp.text().catch(() => "");
			console.error(`TTS server error ${resp.status}: ${body.slice(0, 300)}`);
			return "error";
		}

		const wavBytes = new Uint8Array(await resp.arrayBuffer());
		const tmpFile = "/tmp/pi-tts-output.wav";
		await writeFile(tmpFile, wavBytes);
		await playWav(tmpFile);
		return "ok";
	} catch (err) {
		// Distinguish "server not running" from other failures
		const msg =
			err instanceof Error
				? err.message + (err.cause instanceof Error ? ` (${err.cause.message})` : "")
				: String(err);
		const isUnreachable =
			msg.includes("ECONNREFUSED") || msg.includes("ENOENT") || msg.includes("connection refused");
		if (!isUnreachable) {
			console.error(`TTS server request failed: ${msg}`);
		}
		return isUnreachable ? "unreachable" : "error";
	}
}

/**
 * Slow path: spawn tts-clone directly (cold-starts Python + F5-TTS each call).
 * Used as fallback when the TTS server is not available.
 */
async function speakViaSubprocess(text: string, voice: TtsVoiceProfile, settings: ResolvedTtsSettings): Promise<void> {
	const ttsCli = process.env.TTS_CLI_PATH || "/home/jake/.local/bin/tts-clone";
	const args = [
		"-r",
		voice.ref,
		"-rt",
		voice.refText,
		"-t",
		text,
		"-d",
		"cpu", // Always CPU in subprocess fallback — GPU is likely occupied by TTS server
		"--speed",
		String(settings.speed),
		"-o",
		"/tmp/pi-tts-output.wav",
	];

	// Block all GPU visibility for the fallback subprocess — belt-and-suspenders
	// to ensure it cannot compete with the TTS Docker container for VRAM.
	const env = { ...process.env, CUDA_VISIBLE_DEVICES: "" };

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(ttsCli, args, { stdio: ["ignore", "pipe", "pipe"], env });
		let stderr = "";

		proc.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`TTS failed (code ${code}): ${stderr.slice(0, 200)}`));
				return;
			}
			playWav("/tmp/pi-tts-output.wav").then(resolve).catch(resolve);
		});

		proc.on("error", (err) => {
			reject(err);
		});
	});
}

async function speak(text: string, voice: TtsVoiceProfile, settings: ResolvedTtsSettings): Promise<void> {
	if (!voice.ref || !voice.refText) {
		return;
	}

	const result = await speakViaServer(text, voice, settings);

	if (result === "ok") {
		return;
	}

	if (result === "error") {
		// Server is reachable but failed — the GPU is likely occupied by the TTS
		// container. Do NOT fall back to subprocess, which would compete for the
		// same VRAM and OOM.
		return;
	}

	// result === "unreachable": server is not running, safe to use subprocess
	await speakViaSubprocess(text, voice, settings);
}

export function createTtsExtension(settings: ResolvedTtsSettings): ExtensionFactory {
	return function ttsExtension(pi) {
		if (!settings.enabled) {
			return;
		}

		// Register a per-instance voice override flag.
		// Usage: pi --tts-voice alice  (or set PI_TTS_VOICE=alice in the environment)
		// This lets multiple parallel pi instances each have a distinct voice.
		pi.registerFlag("tts-voice", {
			description: "Override TTS voice profile for this instance (name from settings.tts.voices)",
			type: "string",
			default: "",
		});

		/**
		 * Resolve which voice profile to use.
		 * Priority: --tts-voice flag > PI_TTS_VOICE env var > agentVoices[model.id] > defaultVoice
		 */
		function getVoice(ctx: { model: { id: string; name: string } | undefined }): TtsVoiceProfile {
			const fallback: TtsVoiceProfile = settings.voices[settings.defaultVoice] ?? { ref: "", refText: "" };

			// 1. Explicit CLI flag
			const flag = String(pi.getFlag("tts-voice") ?? "").trim();
			if (flag && settings.voices[flag]) return settings.voices[flag];

			// 2. Environment variable (useful in launch scripts)
			const envVoice = (process.env.PI_TTS_VOICE ?? "").trim();
			if (envVoice && settings.voices[envVoice]) return settings.voices[envVoice];

			// 3. Per-model mapping (agentVoices: { "claude-sonnet-4-20250514": "alice" })
			const model = ctx.model;
			if (model) {
				const byId = settings.agentVoices[model.id];
				if (byId && settings.voices[byId]) return settings.voices[byId];
				const byName = settings.agentVoices[model.name];
				if (byName && settings.voices[byName]) return settings.voices[byName];
			}

			// 4. Default
			return fallback;
		}

		pi.on("turn_end", async (event, ctx) => {
			if (!settings.events.turnEnd) {
				return;
			}

			const message = event.message;
			if (message.role !== "assistant") {
				return;
			}

			const text = extractAnnouncementText(message, settings.maxLength);
			if (!text) {
				return;
			}

			const voice = getVoice(ctx);

			try {
				await speak(text, voice, settings);
			} catch (err) {
				console.error("TTS error:", err);
			}
		});

		pi.on("agent_end", async (event, ctx) => {
			if (!settings.events.agentEnd) {
				return;
			}

			// Find the last assistant message to summarize the session
			const messages = event.messages as AgentMessage[];
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			if (!lastAssistant) {
				return;
			}

			const text = extractAnnouncementText(lastAssistant, settings.maxLength);
			if (!text) {
				return;
			}

			const voice = getVoice(ctx);

			try {
				await speak(text, voice, settings);
			} catch (err) {
				console.error("TTS error:", err);
			}
		});

		// Register /tts command for testing and manual control
		pi.registerCommand("tts", {
			description: "Text-to-speech: /tts <text> to speak, /tts test to test voice, /tts voices to list voices",
			handler: async (args, ctx) => {
				const parts = args.trim().split(/\s+/);
				const cmd = parts[0];

				if (!cmd || cmd === "test") {
					const voice = getVoice(ctx);
					if (!voice.ref) {
						ctx.ui.notify("No voice configured. Add a voice profile to settings.json", "warning");
						return;
					}
					ctx.ui.notify("Testing TTS...", "info");
					try {
						await speak("Text to speech is working correctly.", voice, settings);
						ctx.ui.notify("TTS test complete.", "info");
					} catch (err) {
						ctx.ui.notify(`TTS test failed: ${err}`, "error");
					}
					return;
				}

				if (cmd === "voices") {
					const voices = Object.entries(settings.voices);
					if (voices.length === 0) {
						ctx.ui.notify("No voices configured.", "info");
						return;
					}
					const list = voices.map(([name, v]) => `${name}: ${v.description || v.ref}`).join("\n");
					ctx.ui.notify(`Configured voices:\n${list}`, "info");
					return;
				}

				if (cmd === "set") {
					const voiceName = parts[1];
					if (!voiceName || !settings.voices[voiceName]) {
						ctx.ui.notify(`Unknown voice. Available: ${Object.keys(settings.voices).join(", ")}`, "warning");
						return;
					}
					// Note: This only affects the current session
					settings.defaultVoice = voiceName;
					ctx.ui.notify(`Default voice set to: ${voiceName}`, "info");
					return;
				}

				// Speak the provided text
				const text = args.trim();
				if (!text) {
					ctx.ui.notify("Usage: /tts <text to speak>", "info");
					return;
				}

				const voice = getVoice(ctx);
				try {
					await speak(text, voice, settings);
				} catch (err) {
					ctx.ui.notify(`TTS failed: ${err}`, "error");
				}
			},
		});
	};
}
