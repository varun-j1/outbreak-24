import type { Express } from "express";
import { createMediaEntry, getSessionPlayer } from "./db";
import { storagePut } from "./storage";

const maxBytes = 35 * 1024 * 1024;

export function registerGameMediaRoutes(app: Express) {
  app.post("/api/game-media", async (req, res) => {
    try {
      const { gameId, playerToken, targetPlayerId, kind, dataUrl, mimeType, durationSeconds } = req.body ?? {};
      if (!gameId || !playerToken || !dataUrl || !["photo", "video"].includes(kind)) {
        return res.status(400).json({ error: "Missing media upload fields." });
      }
      const player = await getSessionPlayer({ gameId, playerToken });
      if (kind === "photo" && player.role !== "zombie") return res.status(403).json({ error: "Only zombies can submit a capture photo." });
      if (kind === "photo" && !targetPlayerId) return res.status(400).json({ error: "Select a survivor before submitting a capture." });
      if (kind === "video" && (player.role !== "survivor" || !player.videoDueAt || !player.videoUploadDeadlineAt)) {
        return res.status(403).json({ error: "A survivor video can only be submitted when a scheduled ping requires it." });
      }
      if (kind === "video" && player.videoDueAt && player.videoDueAt > new Date()) {
        return res.status(403).json({ error: "Wait for the scheduled video prompt before recording." });
      }
      if (kind === "video" && player.videoUploadDeadlineAt && player.videoUploadDeadlineAt < new Date()) {
        return res.status(403).json({ error: "The upload grace period has ended; the host has been notified." });
      }
      const encoded = String(dataUrl).includes(",") ? String(dataUrl).split(",").pop()! : String(dataUrl);
      const buffer = Buffer.from(encoded, "base64");
      if (!buffer.length || buffer.length > maxBytes) return res.status(413).json({ error: "Media must be smaller than 35 MB." });
      const extension = kind === "photo" ? "jpg" : "webm";
      const stored = await storagePut(`outbreak/${gameId}/${player.id}/${kind}-${Date.now()}.${extension}`, buffer, mimeType || (kind === "photo" ? "image/jpeg" : "video/webm"));
      const mediaId = await createMediaEntry({
        gameId,
        playerId: player.id,
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
