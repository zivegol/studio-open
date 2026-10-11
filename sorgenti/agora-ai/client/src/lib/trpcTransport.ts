import { toast } from "sonner";

let lastRecoveryNoticeAt = 0;

function notifyTransportRecovery() {
  if (typeof window === "undefined" || Date.now() - lastRecoveryNoticeAt < 3_000) return;
  lastRecoveryNoticeAt = Date.now();
  toast.error("Connessione in ripristino", {
    description: "Agorà AI ha ricevuto una risposta temporaneamente non valida. Attendi qualche secondo oppure ricarica la pagina.",
    action: { label: "Ricarica", onClick: () => window.location.reload() },
  });
}

export async function fetchTrpcResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    notifyTransportRecovery();
    throw new Error("Il servizio Agorà AI si sta riavviando o ha restituito una risposta non valida. Attendi qualche secondo e riprova.");
  }

  return response;
}
