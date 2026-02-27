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
	return `${normalized.slice(0, maxLength - 3)}...`;
}

function extractAnnouncementText(message: AgentMessage, maxLength: number): string | null {
	const text = extractMessageText(message);
	if (!text || !text.trim()) {
		return null;
	}

	// For assistant messages, try to extract the key information
	// Skip very long responses or code-heavy content
	const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
	if (codeBlocks > 2) {
		// Too much code - just announce completion
		return "Task completed with code changes.";
	}

	// Check for common completion patterns
	const lowerText = text.toLowerCase();
	if (lowerText.includes("i've completed") || lowerText.includes("i have completed")) {
		// Extract the completion message
		const match = text.match(/(?:i've|i have) completed[^.]*\./i);
		if (match) {
			return truncateText(match[0], maxLength);
		}
	}

	if (lowerText.includes("done") || lowerText.includes("finished")) {
		return "Task completed.";
	}

	// For short messages, read the whole thing
	if (text.length < maxLength) {
		return truncateText(text, maxLength);
	}

	// For longer messages, just announce completion
	return "Task completed.";
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

/**
 * Fast path: send synthesis request to the persistent TTS server.
 * Returns true if successful, false if the server is unreachable or errors.
 */
async function speakViaServer(text: string, voice: TtsVoiceProfile, settings: ResolvedTtsSettings): Promise<boolean> {
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
			signal: AbortSignal.timeout(30_000),
		});

		if (!resp.ok) {
			console.error(`TTS server returned ${resp.status}`);
			return false;
		}

		const wavBytes = new Uint8Array(await resp.arrayBuffer());
		const tmpFile = "/tmp/pi-tts-output.wav";
		await writeFile(tmpFile, wavBytes);
		await playWav(tmpFile);
		return true;
	} catch {
		// Server not running or network error — caller will fall back to subprocess
		return false;
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
		"auto",
		"--speed",
		String(settings.speed),
		"-o",
		"/tmp/pi-tts-output.wav",
	];

	// Remove CUDA_VISIBLE_DEVICES so the subprocess can see all GPUs
	const env = { ...process.env };
	delete env.CUDA_VISIBLE_DEVICES;

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

	// Try the warm server first (fast). Fall back to cold subprocess if unavailable.
	if (await speakViaServer(text, voice, settings)) {
		return;
	}

	await speakViaSubprocess(text, voice, settings);
}

function getVoiceForAgent(agentName: string | undefined, settings: ResolvedTtsSettings): TtsVoiceProfile {
	if (!agentName) {
		return settings.voices[settings.defaultVoice] || { ref: "", refText: "" };
	}

	// Check agent-specific voice mapping
	const voiceName = settings.agentVoices[agentName] || settings.defaultVoice;
	return settings.voices[voiceName] || settings.voices[settings.defaultVoice] || { ref: "", refText: "" };
}

export function createTtsExtension(settings: ResolvedTtsSettings): ExtensionFactory {
	return function ttsExtension(pi) {
		if (!settings.enabled) {
			return;
		}

		// Check if TTS CLI exists
		const _ttsCli = process.env.TTS_CLI_PATH || "/home/jake/.local/bin/tts-clone";

		pi.on("turn_end", async (event, _ctx) => {
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

			const voice = getVoiceForAgent(undefined, settings); // TODO: get actual agent name

			try {
				await speak(text, voice, settings);
			} catch (err) {
				console.error("TTS error:", err);
			}
		});

		pi.on("agent_end", async (event, _ctx) => {
			if (!settings.events.agentEnd) {
				return;
			}

			// Find the last assistant message
			const messages = event.messages as AgentMessage[];
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			if (!lastAssistant) {
				return;
			}

			const text = extractAnnouncementText(lastAssistant, settings.maxLength);
			if (!text) {
				return;
			}

			const voice = getVoiceForAgent(undefined, settings);

			try {
				await speak(`Session complete. ${text}`, voice, settings);
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
					const voice = getVoiceForAgent(undefined, settings);
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

				const voice = getVoiceForAgent(undefined, settings);
				try {
					await speak(text, voice, settings);
				} catch (err) {
					ctx.ui.notify(`TTS failed: ${err}`, "error");
				}
			},
		});
	};
}
