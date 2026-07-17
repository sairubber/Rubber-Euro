import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { failedRunsTable } from "@workspace/db";

export class ClaudeParseError extends Error {
  constructor(
    message: string,
    public rawResponse: string
  ) {
    super(message);
    this.name = "ClaudeParseError";
  }
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

function extractJson(text: string): string | null {
  // Find the outermost { ... } block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/gm, "")
    .replace(/\s*```$/gm, "")
    .trim();
}

async function doCall(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  useWebSearch: boolean
): Promise<{ text: string }> {
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  const tools = useWebSearch
    ? [{ type: "web_search_20250305" as const, name: "web_search" }]
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (tools) {
    params.tools = tools;
  }

  const response = await client.messages.create(params);

  // Concatenate all text blocks
  const textParts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    }
  }
  const combined = textParts.join("");

  return { text: combined };
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  useWebSearch: boolean,
  promptType: string
): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  let { text } = await doCall(systemPrompt, userMessage, maxTokens, useWebSearch);

  // Truncation guard: if text doesn't end with }, retry with more tokens (cap at 8192)
  const stripped = stripMarkdownFences(text);
  if (!stripped.trimEnd().endsWith("}")) {
    const retryTokens = Math.min(maxTokens + 2000, 8192);
    logger.warn({ promptType, retryTokens }, "Response appears truncated, retrying with more tokens");
    const retry = await doCall(systemPrompt, userMessage, retryTokens, useWebSearch);
    text = retry.text;
  }

  const cleanText = stripMarkdownFences(text);
  const jsonStr = extractJson(cleanText);

  if (!jsonStr) {
    const err = new ClaudeParseError("No JSON object found in response", cleanText);
    await saveFailedRun(promptType, cleanText, err.message);
    throw err;
  }

  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (parseError) {
    const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
    const err = new ClaudeParseError(`JSON parse failed: ${errMsg}`, cleanText);
    await saveFailedRun(promptType, cleanText, err.message);
    throw err;
  }
}

async function saveFailedRun(promptType: string, rawResponse: string, error: string): Promise<void> {
  try {
    await db.insert(failedRunsTable).values({
      prompt_type: promptType,
      raw_response: rawResponse.slice(0, 10000), // cap to avoid huge rows
      error,
    });
  } catch (dbErr) {
    logger.error({ dbErr }, "Failed to save failed run to DB");
  }
}
