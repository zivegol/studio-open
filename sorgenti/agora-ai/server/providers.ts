import { PROVIDERS, type ProviderId } from "../shared/agents";
import { estimateTextTokens, TOKEN_BUDGETS, type ProviderCharge, type ProviderUsage } from "../shared/usage";

export type ProviderRequest = {
  provider: ProviderId;
  apiKey: string;
  role: string;
  prompt: string;
  model?: string | null;
  apiChannel?: "direct" | "openrouter";
  maxOutputTokens?: number;
};

export type ProviderResult = { text: string; usage: ProviderUsage; providerCharge?: ProviderCharge };

const timeout = (ms: number) => AbortSignal.timeout(ms);

function instruction(role: string) {
  return `Ruolo: ${role}. Rispondi in italiano in massimo 450 parole. Struttura: conclusione, 3 punti chiave, fino a 2 rischi/trade-off, 3 prossimi passi. Sii concreto; dichiara le incertezze.`;
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: timeout(110_000) });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 500));
  }
  return data;
}

function outputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (typeof data?.choices?.[0]?.message?.content === "string" && data.choices[0].message.content.trim()) return data.choices[0].message.content.trim();
  if (Array.isArray(data?.choices?.[0]?.message?.content)) {
    const text = data.choices[0].message.content.filter((item: any) => typeof item?.text === "string").map((item: any) => item.text).join("\n").trim();
    if (text) return text;
  }
  if (typeof data?.choices?.[0]?.message?.refusal === "string" && data.choices[0].message.refusal.trim()) throw new Error(data.choices[0].message.refusal.trim());
  if (Array.isArray(data?.content)) {
    const text = data.content.filter((item: any) => item?.type === "text").map((item: any) => item.text).join("\n");
    if (text.trim()) return text.trim();
  }
  const parts: string[] = [];
  const walk = (value: any, depth = 0) => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach(item => walk(item, depth + 1));
    if (typeof value !== "object") return;
    if (typeof value.text === "string") parts.push(value.text);
    if (typeof value.response === "string") parts.push(value.response);
    Object.entries(value).forEach(([key, entry]) => { if (!['text', 'response'].includes(key)) walk(entry, depth + 1); });
  };
  walk(data?.output ?? data);
  const unique = Array.from(new Set(parts.map(item => item.trim()).filter(Boolean)));
  if (unique.length) return unique.join("\n\n");
  if (data?.choices?.[0]?.finish_reason === "length") throw new Error("Il modello ha esaurito il budget di risposta prima di produrre testo. Aumenta il budget o scegli un modello più rapido.");
  throw new Error("Il modello ha risposto senza contenuto testuale. Prova a verificare di nuovo il modello oppure scegline un’alternativa.");
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return undefined;
}

function usageFromPayload(data: any, request: ProviderRequest, text: string): ProviderUsage {
  const usage = data?.usage ?? data?.usage_metadata ?? data?.usageMetadata ?? data?.response?.usage;
  const inputTokens = numberValue(usage?.input_tokens, usage?.prompt_tokens, usage?.promptTokenCount, usage?.inputTokenCount);
  const outputTokens = numberValue(usage?.output_tokens, usage?.completion_tokens, usage?.candidatesTokenCount, usage?.outputTokenCount);
  const totalTokens = numberValue(usage?.total_tokens, usage?.totalTokenCount);
  if (inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
    const normalizedInput = inputTokens ?? Math.max(0, (totalTokens ?? 0) - (outputTokens ?? 0));
    const normalizedOutput = outputTokens ?? Math.max(0, (totalTokens ?? 0) - normalizedInput);
    return { inputTokens: normalizedInput, outputTokens: normalizedOutput, totalTokens: totalTokens ?? normalizedInput + normalizedOutput, source: "reported" };
  }
  const estimatedInput = estimateTextTokens(`${instruction(request.role)}\n${request.prompt}`);
  const estimatedOutput = estimateTextTokens(text);
  return { inputTokens: estimatedInput, outputTokens: estimatedOutput, totalTokens: estimatedInput + estimatedOutput, source: "estimated" };
}

function resultWithUsage(data: any, request: ProviderRequest): ProviderResult {
  const providerError = data?.error?.message || data?.error?.metadata?.raw || data?.error;
  if (providerError) throw new Error(String(providerError).slice(0, 500));
  const text = outputText(data);
  const providerCharge = request.apiChannel === "openrouter" && Number.isFinite(Number(data?.usage?.cost))
    ? { amount: Number(data.usage.cost), unit: "openrouter_credits" as const, source: "provider" as const }
    : undefined;
  return { text, usage: usageFromPayload(data, request, text), providerCharge };
}

async function manusCreditUsage(taskId: string, apiKey: string): Promise<ProviderCharge | undefined> {
  try {
    const detail = await requestJson(`https://api.manus.ai/v2/task.detail?task_id=${encodeURIComponent(taskId)}`, { headers: { "x-manus-api-key": apiKey } });
    const credits = Number(detail?.task?.credit_usage ?? detail?.data?.task?.credit_usage);
    return Number.isFinite(credits) && credits >= 0 ? { amount: credits, unit: "manus_credits", source: "provider" } : undefined;
  } catch {
    return undefined;
  }
}

async function runManus(request: ProviderRequest): Promise<ProviderResult> {
  const { apiKey, role, prompt } = request;
  const created = await requestJson("https://api.manus.ai/v2/task.create", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey },
    body: JSON.stringify({
      message: { content: `${instruction(role)}\nNon eseguire azioni esterne e non fare domande di chiarimento: produci direttamente un’analisi testuale.\n\nRichiesta del cliente:\n${prompt}` },
      structured_output_schema: { type: "object", properties: { response: { type: "string" } }, required: ["response"], additionalProperties: false },
    }),
  });
  const taskId = created?.data?.task_id || created?.data?.id || created?.task_id || created?.id;
  if (!taskId) throw new Error("Manus non ha restituito l’identificativo dell’attività.");

  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const payload = await requestJson(`https://api.manus.ai/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=50`, { headers: { "x-manus-api-key": apiKey } });
    const events = [payload?.data?.messages, payload?.data?.events, payload?.messages, payload?.events, payload?.data].find(Array.isArray) ?? [];
    const serialized = JSON.stringify(events);
    if (/"agent_status"\s*:\s*"(?:error|failed)"/i.test(serialized)) throw new Error("L’attività Manus non è stata completata.");
    if (/"agent_status"\s*:\s*"waiting"/i.test(serialized)) throw new Error("Manus richiede un chiarimento o una conferma; prova a rendere il tema più specifico.");
    for (const event of events) {
      let text: string | undefined;
      if (event?.type === "structured_output_result" && event?.structured_output_result?.success && typeof event?.structured_output_result?.value?.response === "string") text = event.structured_output_result.value.response.trim();
      if (event?.type === "assistant_message") {
        const content = event?.assistant_message?.content ?? event?.content;
        if (typeof content === "string" && content.trim()) text = content.trim();
        if (Array.isArray(content)) text = content.filter(item => typeof item?.text === "string").map(item => item.text).join("\n").trim();
      }
      if (text) return { text, usage: usageFromPayload(payload, request, text), providerCharge: await manusCreditUsage(taskId, apiKey) };
    }
  }
  throw new Error("Manus sta ancora elaborando. Riprova tra qualche istante.");
}

async function runOpenRouter(request: ProviderRequest, model: string | null): Promise<ProviderResult> {
  const prefix = request.provider === "openai" ? "openai" : request.provider === "anthropic" ? "anthropic" : request.provider === "gemini" ? "google" : request.provider === "kimi" ? "moonshotai" : "perplexity";
  const openRouterModel = model?.includes("/") ? model : `${prefix}/${model ?? PROVIDERS[request.provider].defaultModel}`;
  const messages: Array<{ role: string; content: string }> = [{ role: "system", content: instruction(request.role) }, { role: "user", content: request.prompt }];
  const parts: ProviderResult[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const data = await requestJson("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}`, "X-OpenRouter-Title": "Agorà AI" },
      body: JSON.stringify({ model: openRouterModel, max_tokens: request.maxOutputTokens ?? TOKEN_BUDGETS[request.provider].initialOutput, messages }),
    });
    const part = resultWithUsage(data, request);
    parts.push(part);
    if (data?.choices?.[0]?.finish_reason !== "length") break;
    messages.push({ role: "assistant", content: part.text }, { role: "user", content: "Continua esattamente dal punto interrotto, senza ripetere quanto già scritto. Concludi la risposta e chiudi eventuali elenchi o frasi rimaste aperte." });
  }
  return {
    text: parts.map(part => part.text).join("\n").trim(),
    usage: { inputTokens: parts.reduce((sum, part) => sum + part.usage.inputTokens, 0), outputTokens: parts.reduce((sum, part) => sum + part.usage.outputTokens, 0), totalTokens: parts.reduce((sum, part) => sum + part.usage.totalTokens, 0), source: parts.every(part => part.usage.source === "reported") ? "reported" as const : "estimated" as const },
    providerCharge: parts.every(part => part.providerCharge?.unit === "openrouter_credits") ? { amount: parts.reduce((sum, part) => sum + (part.providerCharge?.amount ?? 0), 0), unit: "openrouter_credits", source: "provider" } : undefined,
  };
}

export async function runProvider(request: ProviderRequest): Promise<ProviderResult> {
  const system = instruction(request.role);
  const model = request.model?.trim() || PROVIDERS[request.provider].defaultModel;
  const maxOutputTokens = request.maxOutputTokens ?? TOKEN_BUDGETS[request.provider].initialOutput;
  switch (request.provider) {
    case "openai": {
      if (request.apiChannel === "openrouter") return runOpenRouter(request, model);
      const data = await requestJson("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` }, body: JSON.stringify({ model, store: false, max_output_tokens: maxOutputTokens, input: [{ role: "developer", content: system }, { role: "user", content: request.prompt }] }) });
      return resultWithUsage(data, request);
    }
    case "anthropic": {
      if (request.apiChannel === "openrouter") return runOpenRouter(request, model);
      const data = await requestJson("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": request.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: maxOutputTokens, system, messages: [{ role: "user", content: request.prompt }] }) });
      return resultWithUsage(data, request);
    }
    case "gemini": {
      if (request.apiChannel === "openrouter") return runOpenRouter(request, model);
      const data = await requestJson("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": request.apiKey }, body: JSON.stringify({ model, store: false, max_output_tokens: maxOutputTokens, system_instruction: system, input: request.prompt }) });
      return resultWithUsage(data, request);
    }
    case "kimi": {
      if (request.apiChannel === "openrouter") return runOpenRouter(request, model);
      const data = await requestJson("https://api.moonshot.ai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` }, body: JSON.stringify({ model, max_tokens: maxOutputTokens, messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }] }) });
      return resultWithUsage(data, request);
    }
    case "perplexity": {
      if (request.apiChannel === "openrouter") return runOpenRouter(request, model);
      const data = await requestJson("https://api.perplexity.ai/v1/agent", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` }, body: JSON.stringify({ preset: "low", max_output_tokens: maxOutputTokens, input: request.prompt, instructions: system, tools: [{ type: "web_search" }] }) });
      return resultWithUsage(data, request);
    }
    case "manus": return runManus(request);
  }
}
