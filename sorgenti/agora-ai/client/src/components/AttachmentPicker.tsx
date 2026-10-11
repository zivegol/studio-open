import { trpc } from "@/lib/trpc";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossibile leggere il file selezionato."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",", 2)[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

function displaySize(size: number) {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

export function AttachmentPicker({ selectedIds, onChange, disabled }: { selectedIds: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [source, setSource] = useState<"external" | "nextcloud">("external");
  const [anonymizationStatus, setAnonymizationStatus] = useState<"anonymized" | "not_anonymized">("anonymized");
  const [confirmed, setConfirmed] = useState(false);
  const attachments = trpc.agora.listAttachments.useQuery(undefined, { staleTime: 0 });
  const upload = trpc.agora.uploadAttachment.useMutation();
  const available = (attachments.data ?? []).filter(attachment => !attachment.sessionId);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (!confirmed) return toast.error("Conferma prima l’invio degli estratti ai provider AI.");
    if (available.length + files.length > MAX_FILES) return toast.error(`Puoi preparare al massimo ${MAX_FILES} allegati per un consiglio.`);
    const unsupported = files.find(file => !/\.(pdf|docx|txt|xlsx)$/i.test(file.name));
    if (unsupported) return toast.error("Sono ammessi soltanto PDF, DOCX, TXT e XLSX.");
    const oversized = files.find(file => file.size > MAX_FILE_BYTES);
    if (oversized) return toast.error("Ogni file può pesare al massimo 10 MB.");
    setUploading(true);
    try {
      const uploaded = [] as Array<{ id: number }>;
      for (const file of files) {
        const base64 = await readAsBase64(file);
        uploaded.push(await upload.mutateAsync({ fileName: file.name, mimeType: file.type || "application/octet-stream", base64, source, anonymizationStatus, confirmAiDisclosure: true }));
      }
      await utils.agora.listAttachments.invalidate();
      onChange([...selectedIds, ...uploaded.map(file => file.id)]);
      toast.success(`${uploaded.length} ${uploaded.length === 1 ? "documento aggiunto" : "documenti aggiunti"} al contesto.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Caricamento del documento non riuscito.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-700"><Paperclip className="h-3.5 w-3.5 text-sky-700" />Documenti di contesto</p>
        <p className="mt-1 max-w-xl text-[11px] leading-4 text-slate-500">PDF, Word, testo o Excel. I file restano privati e vengono inviati agli agenti solo se selezionati qui.</p>
      </div>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading || !confirmed || available.length >= MAX_FILES} className="inline-flex h-9 items-center rounded-xl bg-white px-3 text-[11px] font-extrabold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60">
        {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}{uploading ? "Caricamento…" : "Carica file"}
      </button>
      <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.xlsx" multiple className="hidden" onChange={event => addFiles(Array.from(event.target.files ?? []))} />
    </div>
    <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-2">
      <label className="text-[10px] font-bold text-slate-600">Origine
        <select value={source} onChange={event => setSource(event.target.value as "external" | "nextcloud")} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800">
          <option value="external">File esterno / dispositivo</option><option value="nextcloud">Nextcloud dello Studio</option>
        </select>
      </label>
      <label className="text-[10px] font-bold text-slate-600">Trattamento
        <select value={anonymizationStatus} onChange={event => { setAnonymizationStatus(event.target.value as "anonymized" | "not_anonymized"); setConfirmed(false); }} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800">
          <option value="anonymized">Anonimizzato</option><option value="not_anonymized">Non anonimizzato</option>
        </select>
      </label>
      <label className={`flex items-start gap-2 text-[10px] leading-4 sm:col-span-2 ${anonymizationStatus === "not_anonymized" ? "font-bold text-amber-800" : "text-slate-600"}`}>
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
        <span>{anonymizationStatus === "not_anonymized" ? "Confermo che il file può contenere dati personali o sensibili e autorizzo l’invio dei soli estratti selezionati ai provider AI configurati." : "Confermo l’invio dei soli estratti selezionati ai provider AI configurati."}</span>
      </label>
    </div>
    {available.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{available.map(attachment => {
      const selected = selectedIds.includes(attachment.id);
      return <button key={attachment.id} type="button" onClick={() => onChange(selected ? selectedIds.filter(id => id !== attachment.id) : [...selectedIds, attachment.id])} disabled={disabled} className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${selected ? "bg-sky-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
        <FileText className={`h-4 w-4 shrink-0 ${selected ? "text-sky-200" : "text-sky-700"}`} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-extrabold">{attachment.fileName}</span><span className={`block text-[10px] ${selected ? "text-sky-100" : "text-slate-500"}`}>{displaySize(attachment.sizeBytes)} · {attachment.source === "nextcloud" ? "Nextcloud" : "esterno"} · {attachment.anonymizationStatus === "anonymized" ? "anonimizzato" : "non anonimizzato"}</span></span>
        {selected && <X className="h-3.5 w-3.5 text-sky-100" />}
      </button>;
    })}</div> : <p className="mt-3 text-[11px] text-slate-500">Nessun documento in attesa. Puoi allegarne fino a {MAX_FILES}; ogni file ha un limite di 10 MB.</p>}
    {selectedIds.length > 0 && <p className="mt-2 text-[10px] font-bold text-sky-800">{selectedIds.length} {selectedIds.length === 1 ? "documento sarà usato" : "documenti saranno usati"} nel prossimo consiglio.</p>}
  </div>;
}
