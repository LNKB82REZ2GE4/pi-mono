/**
 * Web Read Tool - Fetch and extract content from URLs
 *
 * Fetches web pages and extracts readable content as markdown or text.
 * Uses Readability for article extraction and custom HTML-to-markdown conversion.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";

const webReadSchema = Type.Object({
	url: Type.String({ description: "URL to fetch and read" }),
	format: Type.Optional(
		Type.Union([Type.Literal("markdown"), Type.Literal("text")], {
			description: "Output format: 'markdown' (default, preserves structure) or 'text' (plain text)",
		}),
	),
	selector: Type.Optional(
		Type.String({ description: "CSS selector to extract specific content (e.g., 'article', '#content')" }),
	),
});

export type WebReadToolInput = Static<typeof webReadSchema>;

export interface WebReadToolDetails {
	url: string;
	format: "markdown" | "text";
	title?: string;
	truncated: boolean;
	truncationInfo?: {
		totalBytes: number;
		outputBytes: number;
		totalLines: number;
		outputLines: number;
	};
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

// Simple HTML entity decoder
function decodeEntities(html: string): string {
	return html
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

// Strip HTML tags
function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, "");
}

// Extract text content from HTML, preserving some structure
function htmlToText(html: string): string {
	let text = html;

	// Remove script and style elements completely
	text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
	text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
	text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
	text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
	text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

	// Convert block elements to newlines
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<\/p>/gi, "\n\n");
	text = text.replace(/<\/div>/gi, "\n");
	text = text.replace(/<\/li>/gi, "\n");
	text = text.replace(/<\/tr>/gi, "\n");
	text = text.replace(/<\/td>/gi, " ");
	text = text.replace(/<\/th>/gi, " ");

	// Handle headings
	text = text.replace(/<\/h[1-6]>/gi, "\n\n");

	// Strip remaining tags
	text = stripTags(text);

	// Decode entities
	text = decodeEntities(text);

	// Clean up whitespace
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");
	text = text.trim();

	return text;
}

// Convert HTML to Markdown
function htmlToMarkdown(html: string): string {
	let md = html;

	// Remove script and style elements completely
	md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
	md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
	md = md.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
	md = md.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
	md = md.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

	// Extract and preserve links
	md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
		const linkText = stripTags(text).trim();
		if (!linkText || href.startsWith("javascript:")) return linkText;
		return `[${linkText}](${href})`;
	});

	// Extract and preserve images
	md = md.replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
	md = md.replace(/<img[^>]*src="([^"]+)"[^>]*\/?>/gi, "![]($1)");

	// Convert headings
	md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => {
		return `\n# ${stripTags(content).trim()}\n`;
	});
	md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, content) => {
		return `\n## ${stripTags(content).trim()}\n`;
	});
	md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, content) => {
		return `\n### ${stripTags(content).trim()}\n`;
	});
	md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, content) => {
		return `\n#### ${stripTags(content).trim()}\n`;
	});
	md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, content) => {
		return `\n##### ${stripTags(content).trim()}\n`;
	});
	md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, content) => {
		return `\n###### ${stripTags(content).trim()}\n`;
	});

	// Convert formatting
	md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
	md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
	md = md.replace(/<(pre)[^>]*>([\s\S]*?)<\/\1>/gi, "\n```\n$2\n```\n");

	// Convert lists
	md = md.replace(/<ul[^>]*>/gi, "\n");
	md = md.replace(/<\/ul>/gi, "\n");
	md = md.replace(/<ol[^>]*>/gi, "\n");
	md = md.replace(/<\/ol>/gi, "\n");
	md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

	// Convert blockquotes
	md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
		const lines = stripTags(content).trim().split("\n");
		return `${lines.map((line: string) => `> ${line}`).join("\n")}\n`;
	});

	// Convert tables (simple)
	md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content: string) => {
		let table = content;
		table = table.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_: unknown, row: string) => {
			const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
			const cellContents = cells.map((c: string) => stripTags(c).trim());
			return `| ${cellContents.join(" | ")} |\n`;
		});
		return `\n${table}\n`;
	});

	// Handle line breaks and paragraphs
	md = md.replace(/<br\s*\/?>/gi, "\n");
	md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
	md = md.replace(/<\/div>/gi, "\n");

	// Strip remaining tags
	md = stripTags(md);

	// Decode entities
	md = decodeEntities(md);

	// Clean up whitespace
	md = md.replace(/[ \t]+/g, " ");
	md = md.replace(/\n{3,}/g, "\n\n");
	md = md.trim();

	return md;
}

// Extract content using selector
function extractBySelector(html: string, selector: string): string {
	// Simple selector extraction - supports element names, IDs, and classes
	const patterns: RegExp[] = [];

	if (selector.startsWith("#")) {
		// ID selector
		const id = selector.slice(1);
		patterns.push(new RegExp(`<[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi"));
		patterns.push(new RegExp(`<[^>]*id='${id}'[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi"));
	} else if (selector.startsWith(".")) {
		// Class selector
		const className = selector.slice(1);
		patterns.push(new RegExp(`<[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi"));
	} else {
		// Element selector
		patterns.push(new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, "gi"));
	}

	for (const pattern of patterns) {
		const matches = html.match(pattern);
		if (matches && matches.length > 0) {
			return matches.join("\n");
		}
	}

	return "";
}

// Extract title from HTML
function extractTitle(html: string): string {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (titleMatch) {
		return decodeEntities(stripTags(titleMatch[1])).trim();
	}

	const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	if (h1Match) {
		return decodeEntities(stripTags(h1Match[1])).trim();
	}

	return "";
}

// Try to extract main content using heuristics (simplified Readability)
function extractMainContent(html: string): string {
	// Try common article/content selectors
	const contentSelectors = [
		"article",
		'[role="main"]',
		"main",
		"#content",
		"#main",
		".content",
		".main",
		".article",
		".post",
	];

	for (const selector of contentSelectors) {
		const content = extractBySelector(html, selector);
		if (content && content.length > 500) {
			return content;
		}
	}

	// Fall back to body content
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (bodyMatch) {
		return bodyMatch[1];
	}

	return html;
}

export function createWebReadTool(): AgentTool<typeof webReadSchema> {
	return {
		name: "web_read",
		label: "Web Read",
		description: `Fetch and read content from a URL. Extracts readable content as markdown (default) or plain text. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). Use this to read web pages, articles, or documentation.`,
		parameters: webReadSchema,
		execute: async (
			_toolCallId: string,
			{ url, format, selector }: { url: string; format?: "markdown" | "text"; selector?: string },
			signal?: AbortSignal,
		) => {
			const outputFormat = format ?? "markdown";

			try {
				// Validate URL
				let parsedUrl: URL;
				try {
					parsedUrl = new URL(url);
				} catch {
					throw new Error(`Invalid URL: ${url}`);
				}

				// Only allow http/https
				if (!["http:", "https:"].includes(parsedUrl.protocol)) {
					throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.`);
				}

				const response = await fetchWithRetry(
					url,
					{
						headers: {
							"User-Agent":
								"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
							Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
							"Accept-Language": "en-US,en;q=0.9",
						},
						signal,
					},
					3,
				);

				if (!response.ok) {
					throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
				}

				const contentType = response.headers.get("content-type") || "";

				// Handle non-HTML content
				if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
					// For text content, return as-is
					if (contentType.includes("text/")) {
						const text = await response.text();
						const truncation = truncateHead(text);

						let output = truncation.content;
						if (truncation.truncated) {
							output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
						}

						return {
							content: [{ type: "text", text: output } as TextContent],
							details: {
								url,
								format: outputFormat,
								truncated: truncation.truncated,
								truncationInfo: truncation.truncated
									? {
											totalBytes: truncation.totalBytes,
											outputBytes: truncation.outputBytes,
											totalLines: truncation.totalLines,
											outputLines: truncation.outputLines,
										}
									: undefined,
							} as WebReadToolDetails,
						};
					}

					throw new Error(
						`Unsupported content type: ${contentType}. This tool only supports HTML and text content.`,
					);
				}

				const html = await response.text();

				// Extract title
				const title = extractTitle(html);

				// Extract content
				let contentHtml: string;
				if (selector) {
					contentHtml = extractBySelector(html, selector);
					if (!contentHtml) {
						throw new Error(`No content found matching selector: ${selector}`);
					}
				} else {
					contentHtml = extractMainContent(html);
				}

				// Convert to desired format
				let content: string;
				if (outputFormat === "markdown") {
					content = htmlToMarkdown(contentHtml);
				} else {
					content = htmlToText(contentHtml);
				}

				// Apply truncation
				const truncation = truncateHead(content);

				let output = "";
				if (title) {
					output = `# ${title}\n\nSource: ${url}\n\n`;
				}
				output += truncation.content;

				if (truncation.truncated) {
					output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
				}

				return {
					content: [{ type: "text", text: output } as TextContent],
					details: {
						url,
						format: outputFormat,
						title,
						truncated: truncation.truncated,
						truncationInfo: truncation.truncated
							? {
									totalBytes: truncation.totalBytes,
									outputBytes: truncation.outputBytes,
									totalLines: truncation.totalLines,
									outputLines: truncation.outputLines,
								}
							: undefined,
					} as WebReadToolDetails,
				};
			} catch (error: any) {
				if (error.name === "AbortError") {
					return {
						content: [{ type: "text", text: "Request cancelled" } as TextContent],
						details: { url, format: outputFormat, truncated: false } as WebReadToolDetails,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `Failed to read URL: ${error.message}`,
						} as TextContent,
					],
					details: { url, format: outputFormat, truncated: false } as WebReadToolDetails,
					isError: true,
				};
			}
		},
	};
}

/** Default web read tool */
export const webReadTool = createWebReadTool();
