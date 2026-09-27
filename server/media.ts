import type { Express } from "express";
import { createMediaEntry, validateGameMediaAction } from "./db";
import { storagePut } from "./storage";

const maxBytes = 35 * 1024 * 1024;
const maxProfileBytes = 3 * 1024 * 1024;

function decodeDataUrl(dataUrl: unknown) {
  const encoded = String(dataUrl).includes(",") ? String(dataUrl).split(",").pop()! : String(dataUrl);
  return Buffer.from(encoded, "base64");
}

export function registerGameMediaRoutes(app: Express) {
  app.post("/api/profile-image", async (req, res) => {
    try {
      const { dataUrl, mimeType } = req.body ?? {};
      const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!dataUrl || !allowedMimeTypes.includes(mimeType)) return res.status(400).json({ error: "Choose a JPG, PNG, or WebP image." });
      const buffer = decodeDataUrl(dataUrl);
      if (!buffer.length || buffer.length > maxProfileBytes) return res.status(413).json({ error: "Profile images must be smaller than 3 MB." });
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const stored = await storagePut(`outbreak/profiles/${crypto.randomUUID()}.${extension}`, buffer, mimeType);
      return res.json({ storageKey: stored.key, url: stored.url });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Profile image upload failed." });
    }
  });

  app.post("/api/game-media", async (req, res) => {
    try {
      const { gameId, playerToken, targetPlayerId, kind, dataUrl, mimeType, durationSeconds } = req.body ?? {};
      if (!gameId || !playerToken || !dataUrl || !["photo", "video"].includes(kind)) {
        return res.status(400).json({ error: "Missing media upload fields." });
      }
      const player = await validateGameMediaAction({ gameId, playerToken, targetPlayerId, kind });
      if (kind === "video" && (!Number.isFinite(durationSeconds) || Number(durationSeconds) < 1 || Number(durationSeconds) > 3)) return res.status(400).json({ error: "Field videos must be a compact 3-second recording." });
      const buffer = decodeDataUrl(dataUrl);
      if (!buffer.length || buffer.length > maxBytes) return res.status(413).json({ error: "Media must be smaller than 35 MB." });
      const extension = kind === "photo" ? "jpg" : "webm";
      const stored = await storagePut(`outbreak/${gameId}/${player.id}/${kind}-${Date.now()}.${extension}`, buffer, mimeType || (kind === "photo" ? "image/jpeg" : "video/webm"));
      // Uploads can take a few seconds on mobile. Check the match state again before creating a claim.
      const currentPlayer = await validateGameMediaAction({ gameId, playerToken, targetPlayerId, kind });
      const mediaId = await createMediaEntry({
        gameId,
        playerId: currentPlayer.id,
        targetPlayerId: targetPlayerId || null,
        kind,
        visibility: kind === "photo" ? "target" : "zombies",
        storageKey: stored.key,
        mimeType: mimeType || (kind === "photo" ? "image/jpeg" : "video/webm"),
        durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
      });
      return res.json({ mediaId });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Media upload failed." });
    }
  });
}
