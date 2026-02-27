/**
 * TTS (Text-to-Speech) system types.
 * Supports voice cloning via F5-TTS with per-agent voice profiles.
 */

export interface TtsVoiceProfile {
	/** Path to reference audio file (5-15 seconds of clean speech) */
	ref: string;
	/** Transcript of the reference audio */
	refText: string;
	/** Optional: description of this voice for display purposes */
	description?: string;
}

export interface TtsSettings {
	/** Enable TTS announcements (default: false) */
	enabled?: boolean;
	/** Default voice profile name (default: "default") */
	defaultVoice?: string;
	/** CUDA device for TTS inference (default: "cuda:1" for 2070S) */
	device?: string;
	/** Events that trigger TTS announcements */
	events?: {
		/** Announce when agent turn ends (default: true) */
		turnEnd?: boolean;
		/** Announce when agent session ends (default: true) */
		agentEnd?: boolean;
		/** Announce tool completions (default: false - can be verbose) */
		toolComplete?: boolean;
		/** Custom announcements for specific message patterns */
		custom?: TtsCustomAnnouncement[];
	};
	/** Voice profiles: name -> {ref, refText, description} */
	voices?: Record<string, TtsVoiceProfile>;
	/** Map of agent/model names to voice profile names */
	agentVoices?: Record<string, string>;
	/** Maximum text length to speak (default: 500 chars) */
	maxLength?: number;
	/** Speech speed multiplier (default: 1.0) */
	speed?: number;
}

export interface TtsCustomAnnouncement {
	/** Pattern to match in message content (regex string) */
	pattern: string;
	/** Text to speak when pattern matches (can include $1, $2 for capture groups) */
	speak: string;
	/** Voice to use for this announcement (optional, uses default if not specified) */
	voice?: string;
}

export interface ResolvedTtsSettings {
	enabled: boolean;
	defaultVoice: string;
	device: string;
	events: {
		turnEnd: boolean;
		agentEnd: boolean;
		toolComplete: boolean;
		custom: TtsCustomAnnouncement[];
	};
	voices: Record<string, TtsVoiceProfile>;
	agentVoices: Record<string, string>;
	maxLength: number;
	speed: number;
}

const DEFAULT_VOICE: TtsVoiceProfile = {
	ref: "",
	refText: "",
	description: "Default voice (no reference audio loaded)",
};

export function resolveTtsSettings(settings: { tts?: TtsSettings }): ResolvedTtsSettings {
	const tts = settings.tts;
	return {
		enabled: tts?.enabled ?? false,
		defaultVoice: tts?.defaultVoice ?? "default",
		device: tts?.device ?? "cuda:1",
		events: {
			turnEnd: tts?.events?.turnEnd ?? true,
			agentEnd: tts?.events?.agentEnd ?? true,
			toolComplete: tts?.events?.toolComplete ?? false,
			custom: tts?.events?.custom ?? [],
		},
		voices: tts?.voices ?? { default: DEFAULT_VOICE },
		agentVoices: tts?.agentVoices ?? {},
		maxLength: tts?.maxLength ?? 500,
		speed: tts?.speed ?? 1.0,
	};
}
