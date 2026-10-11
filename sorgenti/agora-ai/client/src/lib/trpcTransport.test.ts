import { afterEach, describe, expect, it, vi } from "vitest";
const { recoveryToast } = vi.hoisted(() => ({ recoveryToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: recoveryToast } }));
import { fetchTrpcResponse } from "./trpcTransport";

describe("fetchTrpcResponse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    recoveryToast.mockClear();
  });

  it("preserva una risposta tRPC JSON", async () => {
    const response = new Response("[]", { headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchTrpcResponse("/api/trpc/agora.settings")).resolves.toBe(response);
  });

  it("traduce una pagina HTML durante un riavvio in un errore di recovery leggibile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
    vi.stubGlobal("window", { location: { reload: vi.fn() } });

    await expect(fetchTrpcResponse("/api/trpc/agora.settings")).rejects.toThrow("servizio Agorà AI si sta riavviando");
    expect(recoveryToast).toHaveBeenCalledWith("Connessione in ripristino", expect.objectContaining({ action: expect.objectContaining({ label: "Ricarica" }) }));
  });
});
