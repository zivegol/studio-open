// Questo file sostituisce server/_core/llm.ts nel progetto originale
// Adapter Anthropic. Il modello è configurabile per evitare dipendenze da ID ritirati.

import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";
export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type FileContent = { type: "file_url"; file_url: { url: string; mime_type?: string } };
export type DocumentContent = { type: "document"; source: { type: "base64"; media_type: string; data: string } };
export type MessageContent = string | TextContent | ImageContent | FileContent | DocumentContent;
export type Message = { role: Role; content: MessageContent | MessageContent[]; name?: string; tool_call_id?: string };
export type Tool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = { type: "function"; function: { name: string } };
export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;
export type InvokeParams = { messages: Message[]; tools?: Tool[]; toolChoice?: ToolChoice; tool_choice?: ToolChoice; maxTokens?: number; max_tokens?: number; outputSchema?: OutputSchema; output_schema?: OutputSchema; responseFormat?: ResponseFormat; response_format?: ResponseFormat };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type InvokeResult = { id: string; created: number; model: string; choices: Array<{ index: number; message: { role: Role; content: string | Array<TextContent | ImageContent | FileContent | DocumentContent>; tool_calls?: ToolCall[] }; finish_reason: string | null }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
export type JsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type OutputSchema = JsonSchema;
export type ResponseFormat = { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: JsonSchema };

function normalizeMessage(message: Message) {
  const { role, name, tool_call_id } = message;
  const ensureArray = (v: MessageContent | MessageContent[]) => Array.isArray(v) ? v : [v];
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map(p => typeof p === "string" ? p : JSON.stringify(p)).join("\n");
    return { role, name, tool_call_id, content };
  }
  const parts = ensureArray(message.content);
  if (parts.length === 1 && typeof parts[0] === "string") return { role, name, content: parts[0] };
  if (parts.length === 1 && (parts[0] as TextContent).type === "text") return { role, name, content: (parts[0] as TextContent).text };
  const normalizedParts = parts.map(part => {
    if (typeof part === "string") return { type: "text", text: part };
    if ((part as FileContent).type === "file_url") {
      return {
        type: "text",
        text: `File non allegato: Anthropic non supporta file_url in questo adapter (${(part as FileContent).file_url?.url ?? "url assente"}).`,
      };
    }
    return part;
  });
  return { role, name, content: normalizedParts };
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = ENV.forgeApiKey;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configurata");

  const { messages, tools, maxTokens, max_tokens, outputSchema, output_schema, responseFormat, response_format } = params;

  // Separa system messages dal resto (Anthropic vuole system a parte)
  const systemMsgs = messages.filter(m => m.role === "system");
  const otherMsgs = messages.filter(m => m.role !== "system");
  const systemText = systemMsgs.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");

  const payload: Record<string, unknown> = {
    model: ENV.anthropicModel,
    max_tokens: maxTokens || max_tokens || 8096,
    messages: otherMsgs.map(normalizeMessage),
  };

  if (systemText) payload.system = systemText;
  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters || { type: "object", properties: {} } }));
  }

  // Gestione output schema -> JSON mode Anthropic
  const requestedFormat = responseFormat || response_format;
  const schema =
    outputSchema ||
    output_schema ||
    (requestedFormat?.type === "json_schema" ? requestedFormat.json_schema : undefined);
  if (schema) {
    payload.system = (payload.system || "") + `\nRispondi ESCLUSIVAMENTE con JSON valido senza markdown. Schema richiesto: ${JSON.stringify(schema.schema)}`;
  } else if (requestedFormat?.type === "json_object") {
    payload.system = (payload.system || "") + "\nRispondi ESCLUSIVAMENTE con un oggetto JSON valido senza markdown o testo extra.";
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} – ${err}`);
  }

  const data = await response.json() as { id: string; model: string; content: Array<{ type: string; text?: string; name?: string; input?: unknown }>; usage: { input_tokens: number; output_tokens: number }; stop_reason: string };

  // Converti risposta Anthropic nel formato OpenAI-compatible atteso dal codice
  const textContent = data.content.find(c => c.type === "text");
  const toolUseContent = data.content.filter(c => c.type === "tool_use");

  const message: { role: Role; content: string; tool_calls?: ToolCall[] } = {
    role: "assistant",
    content: textContent?.text || "",
  };

  if (toolUseContent.length > 0) {
    message.tool_calls = toolUseContent.map((c, i) => ({
      id: `call_${i}`,
      type: "function" as const,
      function: { name: c.name || "", arguments: JSON.stringify(c.input) },
    }));
  }

  return {
    id: data.id,
    created: Date.now(),
    model: data.model,
    choices: [{ index: 0, message, finish_reason: data.stop_reason }],
    usage: { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: data.usage.input_tokens + data.usage.output_tokens },
  };
}
