/**
 * Web Search Tool - Search the web via DuckDuckGo
 *
 * Provides web search capabilities using DuckDuckGo's HTML search.
 * No API key required. Returns URLs, titles, and snippets.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	max_results: Type.Optional(
		Type.Number({ description: "Maximum number of results to return (default: 10, max: 20)" }),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchResult {
	url: string;
	title: string;
	snippet: string;
}

export interface WebSearchToolDetails {
	query: string;
	resultCount: number;
	truncated: boolean;
}

// Rate limit handling: retry with exponential backoff
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(url, options);

			// Rate limited - wait and retry
			if (response.status === 429) {
				const waitTime = 2 ** attempt * 1000 + Math.random() * 1000;
				await new Promise((resolve) => setTimeout(resolve, waitTime));
				continue;
			}

			return response;
		} catch (error) {
			lastError = error as Error;
			if (attempt < maxRetries - 1) {
				const waitTime = 2 ** attempt * 500;
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}
		}
	}

	throw lastError || new Error("Max retries exceeded");
}

// Parse DuckDuckGo HTML search results
function parseDDGResults(html: string, maxResults: number): WebSearchResult[] {
	const results: WebSearchResult[] = [];

	// DDG uses different result containers over time. Try multiple patterns.
	// Pattern 1: <a class="result__a" href="...">Title</a>
	const resultLinkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
	// Pattern 2: data-testid="result-title-a" href="..."
	const resultLinkRegex2 = /<a[^>]*data-testid="result-title-a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;

	// Snippet patterns
	const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gis;
	const snippetRegex2 = /<span[^>]*data-testid="result-snippet"[^>]*>(.*?)<\/span>/gis;

	// Extract URLs and titles
	const urlTitles: { url: string; title: string }[] = [];

	let match: RegExpExecArray | null;
	const usedRegex = resultLinkRegex.test(html) ? resultLinkRegex : resultLinkRegex2;
	usedRegex.lastIndex = 0;

	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration pattern
	while ((match = usedRegex.exec(html)) !== null && urlTitles.length < maxResults) {
		let url = match[1];
		const title = stripTags(match[2]).trim();

		// DDG uses redirect URLs - extract the actual URL
		if (url.includes("uddg=")) {
			const uddgMatch = url.match(/uddg=([^&]+)/);
			if (uddgMatch) {
				url = decodeURIComponent(uddgMatch[1]);
			}
		}

		// Skip ad URLs and internal DDG links
		if (url && !url.startsWith("/") && !url.includes("duckduckgo.com") && title) {
			urlTitles.push({ url, title });
		}
	}

	// Extract snippets
	const snippets: string[] = [];
	const usedSnippetRegex = snippetRegex.test(html) ? snippetRegex : snippetRegex2;
	usedSnippetRegex.lastIndex = 0;

	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration pattern
	while ((match = usedSnippetRegex.exec(html)) !== null && snippets.length < maxResults) {
		snippets.push(stripTags(match[1]).trim());
	}

	// Combine into results
	for (let i = 0; i < urlTitles.length && results.length < maxResults; i++) {
		results.push({
			url: urlTitles[i].url,
			title: urlTitles[i].title,
			snippet: snippets[i] || "",
		});
	}

	return results;
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return {
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using DuckDuckGo. Returns URLs, titles, and snippets for each result. No API key required. Use this to find information on the internet.",
		parameters: webSearchSchema,
		execute: async (
			_toolCallId: string,
			{ query, max_results }: { query: string; max_results?: number },
			signal?: AbortSignal,
		) => {
			const limit = Math.min(max_results ?? 10, 20);

			try {
				// Build DuckDuckGo HTML search URL
				const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

				const response = await fetchWithRetry(
					searchUrl,
					{
						headers: {
							"User-Agent":
								"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
							Accept: "text/html",
							"Accept-Language": "en-US,en;q=0.9",
						},
						signal,
					},
					3,
				);

				if (!response.ok) {
					throw new Error(`Search failed: ${response.status} ${response.statusText}`);
				}

				const html = await response.text();
				const results = parseDDGResults(html, limit);

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: `No results found for "${query}"` } as TextContent],
						details: { query, resultCount: 0, truncated: false } as WebSearchToolDetails,
					};
				}

				// Format results as markdown
				let output = `## Search Results for "${query}"\n\n`;
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					output += `### ${i + 1}. [${r.title}](${r.url})\n`;
					if (r.snippet) {
						output += `${r.snippet}\n`;
					}
					output += `\n`;
				}

				return {
					content: [{ type: "text", text: output } as TextContent],
					details: {
						query,
						resultCount: results.length,
						truncated: false,
					} as WebSearchToolDetails,
				};
			} catch (error: any) {
				if (error.name === "AbortError") {
					return {
						content: [{ type: "text", text: "Search cancelled" } as TextContent],
						details: { query, resultCount: 0, truncated: false } as WebSearchToolDetails,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `Search error: ${error.message}`,
						} as TextContent,
					] as TextContent[],
					details: { query, resultCount: 0, truncated: false } as WebSearchToolDetails,
					isError: true,
				};
			}
		},
	};
}

/** Default web search tool */
export const webSearchTool = createWebSearchTool();
