import { afterEach, describe, expect, it, vi } from "vitest";
import { runProvider } from "./providers";

afterEach(() => vi.unstubAllGlobals());

describe("routing OpenRouter", () => {
  it.each([
    ["openai", "openai/gpt-4.1-mini"],
    ["gemini", "google/gemini-2.5-flash"],
    ["kimi", "moonshotai/kimi-k2.5"],
  ] as const)("instrada %s verso OpenRouter con il modello selezionato", async (provider, model) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, cost: 0.00001 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProvider({ provider, apiKey: "openrouter-test-key", apiChannel: "openrouter", model, role: "verifica", prompt: "Rispondi OK", maxOutputTokens: 32 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ model, max_tokens: 32 });
    expect(result).toMatchObject({ text: "OK", usage: { totalTokens: 14, source: "reported" }, providerCharge: { unit: "openrouter_credits" } });
  });

  it("conserva il messaggio OpenRouter quando il credito non è sufficiente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "This request requires more credits, or fewer max_tokens." } }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(runProvider({ provider: "anthropic", apiKey: "openrouter-test-key", apiChannel: "openrouter", model: "anthropic/claude-opus-4.5", role: "verifica", prompt: "Rispondi OK", maxOutputTokens: 32 })).rejects.toThrow("requires more credits");
  });

  it("legge il contenuto OpenRouter strutturato in parti testuali", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "OK" }] } }], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(runProvider({ provider: "openai", apiKey: "openrouter-test-key", apiChannel: "openrouter", model: "openai/gpt-5-mini", role: "verifica", prompt: "Rispondi OK", maxOutputTokens: 128 })).resolves.toMatchObject({ text: "OK" });
  });

  it("continua automaticamente una risposta OpenRouter interrotta per lunghezza", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Prima parte senza conclusione" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.001 } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Conclusione completa." }, finish_reason: "stop" }], usage: { prompt_tokens: 25, completion_tokens: 8, total_tokens: 33, cost: 0.002 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProvider({ provider: "gemini", apiKey: "openrouter-test-key", apiChannel: "openrouter", model: "google/gemini-3.1-pro-preview", role: "verifica", prompt: "Analizza", maxOutputTokens: 64 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("Prima parte senza conclusione\nConclusione completa.");
    expect(result.usage.totalTokens).toBe(63);
    expect(result.providerCharge?.amount).toBe(0.003);
  });

  it("spiega quando un modello esaurisce il budget prima di emettere testo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "length" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(runProvider({ provider: "openai", apiKey: "openrouter-test-key", apiChannel: "openrouter", model: "openai/gpt-5-mini", role: "verifica", prompt: "Rispondi OK", maxOutputTokens: 32 })).rejects.toThrow("esaurito il budget");
  });
});
