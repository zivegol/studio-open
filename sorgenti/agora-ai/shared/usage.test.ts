import { describe, expect, it } from "vitest";
import { adaptiveOutputBudget } from "./usage";

describe("budget adattivo con documenti", () => {
  const documentPrompt = "Tema sintetico\n\n--- Contesto documentale selezionato ---\nDocumento allegato: bolletta.pdf\ncontenuto\n--- Fine contesto documentale ---";

  it("riserva a ChatGPT un budget iniziale maggiore quando viene allegato un documento", () => {
    expect(adaptiveOutputBudget("openai", "initial", documentPrompt)).toBe(3_200);
  });

  it("preserva un budget di sintesi documentale adeguato", () => {
    expect(adaptiveOutputBudget("anthropic", "synthesis", documentPrompt)).toBe(1_400);
  });
});
