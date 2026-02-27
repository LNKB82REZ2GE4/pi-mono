import type { ExtensionFactory } from "./extensions/index.js";
import { createMemoryExtension } from "./memory/extension.js";
import { resolveMemorySettings } from "./memory/types.js";
import type { SettingsManager } from "./settings-manager.js";
import { createTtsExtension } from "./tts/extension.js";
import { resolveTtsSettings } from "./tts/types.js";

export function getBuiltInExtensionFactories(settingsManager: SettingsManager): ExtensionFactory[] {
	const extensions: ExtensionFactory[] = [];
	const memorySettings = resolveMemorySettings(settingsManager.getAllSettings());
	if (memorySettings.enabled) {
		extensions.push(createMemoryExtension(memorySettings));
	}
	const ttsSettings = resolveTtsSettings(settingsManager.getAllSettings());
	if (ttsSettings.enabled) {
		extensions.push(createTtsExtension(ttsSettings));
	}
	return extensions;
}
