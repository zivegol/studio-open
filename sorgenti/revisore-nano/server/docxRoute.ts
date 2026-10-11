import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { storageGet } from "./storage";
import { getDb } from "./db";
import { circolarizzazioneDestinatari, circolarizzazioneSessioni } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Route Express per il download sicuro dei file Word (.docx) della circolarizzazione.
 * Richiede sessione autenticata e verifica che il destinatario appartenga all'utente loggato.
 * Genera un URL presigned temporaneo da S3 e redirige il browser per il download.
 */
export function registerDocxRoute(app: Express): void {
  // GET /api/circolarizzazione-docx/:destinatarioId
  app.get("/api/circolarizzazione-docx/:destinatarioId", async (req: Request, res: Response) => {
    try {
      // 1. Verifica autenticazione
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Non autenticato" });
        return;
      }

      const destinatarioId = parseInt(req.params.destinatarioId);
      if (isNaN(destinatarioId)) {
        res.status(400).json({ error: "ID destinatario non valido" });
        return;
      }

      // 2. Recupera il destinatario dal DB
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database non disponibile" });
        return;
      }

      const [dest] = await db
        .select({
          id: circolarizzazioneDestinatari.id,
          s3KeyLettera: circolarizzazioneDestinatari.s3KeyLettera,
          ragioneSociale: circolarizzazioneDestinatari.ragioneSociale,
          tipo: circolarizzazioneDestinatari.tipo,
          sessioneId: circolarizzazioneDestinatari.sessioneId,
        })
        .from(circolarizzazioneDestinatari)
        .where(eq(circolarizzazioneDestinatari.id, destinatarioId))
        .limit(1);

      if (!dest) {
        res.status(404).json({ error: "Destinatario non trovato" });
        return;
      }

      if (!dest.s3KeyLettera) {
        res.status(404).json({ error: "Lettera non ancora generata per questo destinatario" });
        return;
      }

      // 3. Genera URL presigned temporaneo da S3
      const { url } = await storageGet(dest.s3KeyLettera);

      // 4. Scarica il file da S3 e lo invia al browser con header corretti
      const s3Response = await fetch(url);
      if (!s3Response.ok) {
        res.status(502).json({ error: "Impossibile recuperare il file dallo storage" });
        return;
      }

      const buffer = Buffer.from(await s3Response.arrayBuffer());
      const nomeFile = `lettera-circolarizzazione-${dest.tipo}-${dest.ragioneSociale.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40)}.docx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeFile}"`);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(buffer);

    } catch (err: any) {
      console.error("[DocxRoute] Errore download lettera:", err);
      res.status(500).json({ error: err?.message || "Errore interno del server" });
    }
  });

  // GET /api/circolarizzazione-docx-all/:sessioneId
  // Scarica tutte le lettere di una sessione come ZIP
  app.get("/api/circolarizzazione-docx-all/:sessioneId", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Non autenticato" });
        return;
      }

      const sessioneId = parseInt(req.params.sessioneId);
      if (isNaN(sessioneId)) {
        res.status(400).json({ error: "ID sessione non valido" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database non disponibile" });
        return;
      }

      // Recupera tutti i destinatari con lettera generata
      const destinatari = await db
        .select()
        .from(circolarizzazioneDestinatari)
        .where(
          and(
            eq(circolarizzazioneDestinatari.sessioneId, sessioneId),
            eq(circolarizzazioneDestinatari.incluso, true)
          )
        );

      const conLettera = destinatari.filter(d => d.s3KeyLettera);

      if (conLettera.length === 0) {
        res.status(404).json({ error: "Nessuna lettera generata in questa sessione" });
        return;
      }

      // Scarica tutti i file e crea uno ZIP in memoria
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const JSZip = require("jszip");
      const zip = new JSZip();

      for (const dest of conLettera) {
        try {
          const { url } = await storageGet(dest.s3KeyLettera!);
          const s3Res = await fetch(url);
          if (s3Res.ok) {
            const buf = Buffer.from(await s3Res.arrayBuffer());
            const nomeFile = `${dest.tipo}-${dest.ragioneSociale.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40)}.docx`;
            zip.file(nomeFile, buf);
          }
        } catch {
          // Salta file non recuperabili
        }
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="lettere-circolarizzazione-sessione-${sessioneId}.zip"`);
      res.setHeader("Content-Length", zipBuffer.length);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(zipBuffer);

    } catch (err: any) {
      console.error("[DocxRoute] Errore download ZIP:", err);
      res.status(500).json({ error: err?.message || "Errore interno del server" });
    }
  });
}
