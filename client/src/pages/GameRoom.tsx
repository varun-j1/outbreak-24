import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, Camera, Check, ChevronLeft, CirclePause, Compass, Copy, Crosshair, Download, FileVideo, Flag, Gamepad2, Info, Map, MapPin, PackageOpen, Pause, Play, Radio, ScanLine, ShieldAlert, Square, Timer, Users, Video, Wifi, WifiOff, X,
} from "lucide-react";
import { toast } from "sonner";
import TacticalMap from "@/components/TacticalMap";
import { clearGameSession, loadGameSession, type GameSession } from "@/lib/game-session";
import { trpc } from "@/lib/trpc";

type View = "map" | "activity" | "inventory";
type Snapshot = any;

const formatClock = (seconds: number) => `${String(Math.max(0, Math.floor(seconds / 60))).padStart(2, "0")}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
const timeValue = (value?: string | Date | null) => value ? new Date(value).getTime() : 0;
const titleCase = (value: string) => value.split("_").map(part => part[0]?.toUpperCase() + part.slice(1)).join(" ");
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
const buzz = (pattern: number | number[] = 24) => { if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern); };

function useLocalClock(start: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(interval); }, []);
  return now - start;
}

function MediaCapture({ mode, targetName, onClose, onComplete }: { mode: "photo" | "video"; targetName?: string; onClose: () => void; onComplete: (blob: Blob) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(5);
  const [captured, setCaptured] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let live = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(stream => { if (!live) { stream.getTracks().forEach(track => track.stop()); return; } streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; })
      .catch(() => setError("Camera access is required. Check your browser permission, then try again."));
    return () => { live = false; streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [mode]);

  const finish = async (blob: Blob) => {
    setBusy(true);
    try { await onComplete(blob); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed. Please retry."); setBusy(false); }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return setError("Camera is still starting. Try again in a moment.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return setError("Could not process this photo.");
      // Capture is complete before the network work begins. Stop the camera and return the zombie to play instantly.
      setCaptured(true);
      setFlash(true);
      streamRef.current?.getTracks().forEach(track => track.stop());
      void onComplete(blob);
      window.setTimeout(onClose, 180);
    }, "image/jpeg", 0.88);
  };

  const record = () => {
    const stream = streamRef.current;
    if (!stream) return setError("Camera is still starting. Try again in a moment.");
    if (!window.MediaRecorder) return setError("This browser cannot record video. Use a current mobile browser.");
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => finish(new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" }));
    recorder.start(); setRecording(true); setRemaining(5);
    const countdown = window.setInterval(() => setRemaining(value => value - 1), 1_000);
    window.setTimeout(() => { window.clearInterval(countdown); recorder.stop(); }, 5_000);
  };

  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5">
    <div className="w-full max-w-md overflow-hidden rounded-t-[1.75rem] border border-white/10 bg-[#0a151a] shadow-2xl sm:rounded-[1.75rem]">
      <div className="flex items-center justify-between px-5 py-4"><div><div className="text-xs font-bold tracking-[0.14em] text-teal-200">{mode === "photo" ? "CAPTURE CONFIRMATION" : "PING EVIDENCE"}</div><div className="font-black text-white">{mode === "photo" ? `Photograph ${targetName ?? "target"}` : "Record 5-second surroundings video"}</div></div><button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X size={20} /></button></div>
      <div className="relative aspect-[3/4] bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />{flash && <div className="absolute inset-0 bg-white/90" />}{recording && <div className="absolute inset-0 grid place-items-center bg-black/25"><div className="grid h-20 w-20 place-items-center rounded-full border-2 border-[#ff455c] bg-black/50 text-2xl font-black text-white">{remaining}</div></div>}{error && <div className="absolute inset-x-4 bottom-4 rounded-xl bg-[#ff455c] p-3 text-sm font-bold text-[#071116]">{error}</div>}</div>
      <div className="p-5"><button disabled={busy || recording || captured || !!error} onClick={mode === "photo" ? takePhoto : record} className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 py-3 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]">{mode === "photo" ? <Camera size={18} /> : <Video size={18} />}{captured ? "PHOTO CAPTURED" : busy ? "UPLOADING..." : recording ? "RECORDING..." : mode === "photo" ? "TAKE PHOTO" : "START 5-SECOND VIDEO"}</button><p className="mt-3 text-center text-xs leading-5 text-slate-500">{mode === "photo" ? "The camera closes instantly. Your capture request uploads in the background and alerts the survivor." : "Only zombies and the host can view this surroundings video."}</p></div>
    </div>
  </div>;
}

export default function GameRoom() {
  const [, navigate] = useLocation();
  const initialSession = useMemo(() => loadGameSession(), []);
  const [session] = useState<GameSession | null>(initialSession);
  const safeSession = session ?? { gameId: "no-game", playerToken: "no-session-token-is-valid", playerId: "", joinCode: "", rejoinCode: "" };
  const [view, setView] = useState<View>("map");
  const [captureTarget, setCaptureTarget] = useState<any | null>(null);
  const [mediaMode, setMediaMode] = useState<"photo" | "video" | null>(null);
  const [setupCenter, setSetupCenter] = useState({ lat: -34.92051, lng: 138.60456 });
  const [setupInitialRadius, setSetupInitialRadius] = useState(500);
  const [setupMinimumRadius, setSetupMinimumRadius] = useState(150);
  const [setupMatchMinutes, setSetupMatchMinutes] = useState(12);
  const [setupPoints, setSetupPoints] = useState<Array<{ id?: string; type: "extraction" | "powerup_candidate"; label: string; lat: number; lng: number }>>([]);
  const [pointMode, setPointMode] = useState<"extraction" | "powerup_candidate">("extraction");
  const [setupHydrated, setSetupHydrated] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const lastReportedRef = useRef(0);
  const knownClaimIdsRef = useRef<Set<string>>(new Set());
  const latestEventIdRef = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const snapshot = trpc.game.snapshot.useQuery(safeSession, { enabled: !!session, refetchInterval: 1_500, refetchIntervalInBackground: true, retry: 1 });
  const data = snapshot.data as Snapshot | undefined;
  const clock = useLocalClock(data?.game?.startedAt ? timeValue(data.game.startedAt) : Date.now());
  const createSetup = trpc.game.saveSetup.useMutation();
  const setReady = trpc.game.setReady.useMutation();
  const assignZombie = trpc.game.assignZombie.useMutation();
  const start = trpc.game.start.useMutation();
  const pause = trpc.game.pause.useMutation();
  const reportLocation = trpc.game.reportLocation.useMutation();
  const collectItem = trpc.game.collectItem.useMutation();
  const useItem = trpc.game.useItem.useMutation();
  const resolveCapture = trpc.game.resolveCapture.useMutation();

  useEffect(() => { if (!session) navigate("/"); }, [session, navigate]);
  useEffect(() => {
    if (!data || setupHydrated || !(data.game.status === "setup" || data.game.status === "lobby")) return;
    setSetupCenter({ lat: data.game.centerLat, lng: data.game.centerLng });
    setSetupInitialRadius(data.game.initialRadius); setSetupMinimumRadius(data.game.minimumRadius);
    setSetupMatchMinutes(Math.round(data.game.rules.matchSeconds / 60));
    setSetupPoints(data.points.map((point: any) => ({ id: point.id, type: point.type, label: point.label, lat: point.lat, lng: point.lng })));
    setSetupHydrated(true);
  }, [data, setupHydrated]);

  useEffect(() => {
    if (!session || data?.game?.status !== "running" || !locationGranted || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(position => {
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCurrentLocation(coordinates);
      if (Date.now() - lastReportedRef.current > 3_500) {
        lastReportedRef.current = Date.now();
        reportLocation.mutate({ ...safeSession, ...coordinates, accuracy: Math.round(position.coords.accuracy) });
      }
    }, () => toast.error("Location is temporarily unavailable. Move to open sky or check permissions if it does not recover."), { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [session, data?.game?.status, locationGranted]);

  useEffect(() => {
    const targetClaims = data?.claims?.filter((claim: any) => claim.targetPlayerId === session?.playerId && claim.status === "pending") ?? [];
    const newClaim = targetClaims.find((claim: any) => !knownClaimIdsRef.current.has(claim.id));
    targetClaims.forEach((claim: any) => knownClaimIdsRef.current.add(claim.id));
    if (newClaim) {
      setView("activity");
      toast.error("CAPTURE REVIEW REQUIRED — confirm or dispute the new photo.", { duration: 10_000 });
    }
  }, [data?.claims, session?.playerId]);

  useEffect(() => {
    const latest = data?.events?.[0];
    if (!latest) return;
    if (latestEventIdRef.current && latestEventIdRef.current !== latest.id) {
      const pulses: Record<string, number | number[]> = {
        survivor_ping: [35, 45, 35], extraction_points_revealed: [80, 70, 80, 70, 140], capture_requested: [120, 70, 120], capture_confirmed: [90, 50, 90], storm_warning: [45, 55, 45], player_turned: [130, 60, 130],
      };
      if (pulses[latest.type]) buzz(pulses[latest.type]);
    }
    latestEventIdRef.current = latest.id;
  }, [data?.events]);

  const refresh = () => utils.game.snapshot.invalidate(safeSession);
  const saveSetup = async () => {
    try { await createSetup.mutateAsync({ ...safeSession, centerLat: setupCenter.lat, centerLng: setupCenter.lng, initialRadius: setupInitialRadius, minimumRadius: setupMinimumRadius, matchMinutes: setupMatchMinutes, points: setupPoints }); toast.success("Playing area saved. Lobby is open."); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save setup."); }
  };
  const requestLocation = () => new Promise<boolean>(resolve => {
    if (!navigator.geolocation) { toast.error("This browser does not provide GPS location."); resolve(false); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCurrentLocation(coordinates); setSetupCenter(coordinates); setLocationGranted(true);
      toast.success("Location permission granted. Map centre set from GPS."); resolve(true);
    }, () => { toast.error("Location permission was not granted. Enable it in your browser to play."); resolve(false); }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
  });
  const requestCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("This browser does not provide camera access."); return false; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream.getTracks().forEach(track => track.stop());
      setCameraGranted(true); toast.success("Camera permission granted. It stays off until capture is needed."); return true;
    } catch { toast.error("Camera permission was not granted. Enable it in your browser to capture or verify game media."); return false; }
  };
  const requestFieldPermissions = async () => {
    setPermissionsBusy(true);
    try {
      // Mobile browsers present permission sheets more reliably one after the other than in parallel.
      const location = await requestLocation();
      const camera = await requestCamera();
      return location && camera;
    }
    finally { setPermissionsBusy(false); }
  };
  const addPoint = (position: { lat: number; lng: number }) => {
    if (!data?.viewer?.isHost || !(data.game.status === "setup" || data.game.status === "lobby")) return;
    if (pointMode === "extraction" && setupPoints.filter(point => point.type === "extraction").length >= 4) return toast.error("You already have four potential extraction points.");
    setSetupPoints(points => {
      const number = points.filter(point => point.type === pointMode).length + 1;
      return [...points, { type: pointMode, label: pointMode === "extraction" ? `EXTRACT ${number}` : `POWER ${number}`, lat: position.lat, lng: position.lng }];
    });
  };
  const copy = async (value: string, label: string) => { await navigator.clipboard?.writeText(value); toast.success(`${label} copied.`); };
  const perform = async (operation: () => Promise<unknown>) => { try { await operation(); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Command failed."); } };
  const uploadMedia = async (blob: Blob) => {
    if (!session || !mediaMode) return;
    const isPhoto = mediaMode === "photo";
    if (isPhoto) setPhotoUploading(true);
    const loadingToast = toast.loading(isPhoto ? "Sending capture request…" : "Uploading surroundings video…");
    try {
      const response = await fetch("/api/game-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId: session.gameId, playerToken: session.playerToken, targetPlayerId: captureTarget?.id ?? null, kind: mediaMode, dataUrl: await toDataUrl(blob), mimeType: blob.type || (isPhoto ? "image/jpeg" : "video/webm"), durationSeconds: mediaMode === "video" ? 5 : null }) });
      const body = await response.json();
      if (!response.ok) { toast.error(body.error ?? "Upload failed.", { id: loadingToast }); return; }
      toast.success(isPhoto ? "Capture request sent — the survivor has been alerted." : "Surroundings video uploaded.", { id: loadingToast });
      refresh();
    } catch { toast.error("Upload failed. Check your connection and try again.", { id: loadingToast }); }
    finally { if (isPhoto) setPhotoUploading(false); }
  };

  if (!session) return null;
  if (snapshot.isLoading || !data) return <div className="grid min-h-screen place-items-center bg-[#071116] text-teal-200"><div className="text-center"><Radio className="mx-auto mb-3 animate-pulse" /><div className="text-sm font-bold tracking-[0.18em]">CONNECTING TO FIELD OPS</div></div></div>;
  if (snapshot.error) return <div className="grid min-h-screen place-items-center bg-[#071116] p-6 text-center text-slate-100"><div><AlertTriangle className="mx-auto mb-3 text-[#ff455c]" /><h1 className="text-xl font-black">SESSION UNAVAILABLE</h1><p className="mt-2 text-sm text-slate-400">{snapshot.error.message}</p><button onClick={() => { clearGameSession(); navigate("/"); }} className="mt-6 rounded-xl bg-teal-300 px-4 py-3 text-sm font-black text-[#071116]">RETURN HOME</button></div></div>;

  const game = data.game;
  const viewer = data.viewer;
  const player = data.players.find((entry: any) => entry.id === viewer.id);
  const elapsed = game.status === "running" ? Math.max(0, Math.floor((clock / 1000) - game.pausedSeconds)) : game.elapsedSeconds;
  const remaining = Math.max(0, game.rules.matchSeconds - elapsed);
  const survivors = data.players.filter((entry: any) => entry.role === "survivor" && entry.status === "active").length;
  const headStart = elapsed < game.rules.headStartSeconds;
  const extractionOpen = elapsed >= game.rules.extractionOpensAtSeconds;
  const pingIn = Math.max(0, Math.round((timeValue(game.nextPingAt) - Date.now()) / 1000));
  const videoDueAt = timeValue(viewer.videoDueAt);
  const videoDeadlineAt = timeValue(viewer.videoUploadDeadlineAt);
  const videoReady = Boolean(videoDueAt && videoDueAt <= Date.now() && videoDeadlineAt > Date.now());
  const videoPending = Boolean(videoDueAt && videoDueAt > Date.now());
  const currentClaims = data.claims.filter((claim: any) => claim.status === "pending" || claim.status === "disputed");
  const pendingReviewClaim = data.claims.find((claim: any) => claim.targetPlayerId === viewer.id && claim.status === "pending");
  const captureCandidates = data.players.filter((entry: any) => entry.role === "survivor" && entry.status === "active" && entry.id !== viewer.id);
  const nextAction = pendingReviewClaim
    ? { title: "REVIEW CAPTURE PHOTO", note: "Open Activity and confirm or dispute the evidence now." }
    : viewer.role === "survivor" && videoReady
      ? { title: "RECORD REQUIRED VIDEO", note: "Take a five-second field video now to clear your scheduled check." }
      : viewer.role === "survivor" && extractionOpen
        ? { title: "REACH A REVEALED EXIT", note: "Gold exits are live. Hold inside one for 10 seconds to escape." }
        : viewer.role === "survivor" && headStart
          ? { title: "CREATE DISTANCE", note: `Use your ${formatClock(game.rules.headStartSeconds - elapsed)} head start before infected begin hunting.` }
          : viewer.role === "zombie" && headStart
            ? { title: "HOLD POSITION", note: `Hunt unlocks in ${formatClock(game.rules.headStartSeconds - elapsed)}.` }
            : viewer.role === "zombie"
              ? { title: "TRACK THE NEXT PING", note: pingIn ? `Survivor portrait pings arrive in ${formatClock(pingIn)}. Follow trails or take a capture photo.` : "A new survivor ping is being transmitted." }
              : { title: "STAY MOVING", note: `Exits unlock in ${formatClock(game.rules.extractionOpensAtSeconds - elapsed)}. Team power drops will appear on your map.` };

  if (game.status === "setup") return <SetupScreen center={setupCenter} radius={setupInitialRadius} minRadius={setupMinimumRadius} matchMinutes={setupMatchMinutes} points={setupPoints} pointMode={pointMode} isHost={viewer.isHost} currentLocation={currentLocation} setInitial={setSetupInitialRadius} setMinimum={setSetupMinimumRadius} setMatchMinutes={setSetupMatchMinutes} setPointMode={setPointMode} setPoints={setSetupPoints} onMapClick={addPoint} onUseGps={requestLocation} onSave={saveSetup} busy={createSetup.isPending} />;
  if (game.status === "lobby") return <LobbyScreen game={game} viewer={viewer} players={data.players} locationGranted={locationGranted} cameraGranted={cameraGranted} permissionsBusy={permissionsBusy} onRequestPermissions={requestFieldPermissions} onReady={async () => { if (!locationGranted || !cameraGranted) { const granted = await requestFieldPermissions(); if (!granted) return; } await perform(() => setReady.mutateAsync({ ...safeSession, isReady: !player?.isReady })); }} onAssign={(playerId: string, isZombie: boolean) => perform(() => assignZombie.mutateAsync({ ...safeSession, playerId, isZombie }))} onStart={async () => { if (!locationGranted || !cameraGranted) { const granted = await requestFieldPermissions(); if (!granted) return; } setBriefingOpen(true); }} onCopy={() => copy(game.joinCode, "Join code")} recoveryCode={session.rejoinCode} onCopyRecovery={() => copy(session.rejoinCode, "Recovery code")} briefingOpen={briefingOpen} onDismissBriefing={() => { setBriefingOpen(false); void perform(() => start.mutateAsync(safeSession)); }} />;

  return <main className="min-h-screen bg-[#071116] text-slate-100">
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#071116]/95 px-4 py-3 backdrop-blur-md"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><button onClick={() => { clearGameSession(); navigate("/"); }} className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><ChevronLeft size={20} /></button><PlayerAvatar player={player ?? viewer} size="h-9 w-9" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${game.status === "paused" ? "bg-amber-300" : "bg-teal-300"}`} /><span className="truncate text-xs font-black tracking-[0.16em]">{viewer.role === "zombie" ? "INFECTED OPS" : "SURVIVOR OPS"}</span></div><div className="mt-1 text-[10px] font-bold text-slate-500">CODE {game.joinCode} · {survivors} SURVIVOR{survivors === 1 ? "" : "S"} ACTIVE</div></div><div className="rounded-xl border border-white/10 bg-[#0c1a20] px-3 py-1.5 text-right"><div className="text-[9px] font-bold tracking-[0.15em] text-slate-500">MATCH TIME</div><div className="font-mono text-lg font-black text-white">{formatClock(remaining)}</div></div></div></header>
    <div className="mx-auto max-w-5xl p-4 pb-28">
      {game.status === "paused" && <AlertBanner tone="amber" icon={<Pause size={17} />} text="GAME PAUSED — host must resume after the field team recovers." />}
      {player?.boundaryExposed && <AlertBanner tone="red" icon={<AlertTriangle size={17} />} text="OUT OF BOUNDS — return to the safe zone or you will forfeit." />}
      {player?.exposureUntil && timeValue(player.exposureUntil) > Date.now() && <AlertBanner tone="red" icon={<Wifi size={17} />} text="LOCATION EXPOSED — infected can see your live marker." />}
      {viewer.staleLocationSeconds > 45 && <AlertBanner tone="amber" icon={<WifiOff size={17} />} text={viewer.staleLocationSeconds > 180 ? "LOCATION STALE — the match is pausing for safety." : "LOCATION STALE — move to open sky or check GPS permissions."} />}
      {viewer.role === "survivor" && videoReady && <AlertBanner tone="red" icon={<Video size={17} />} text="VIDEO DUE — record five seconds of your surroundings before the upload grace period ends." />}
      {pendingReviewClaim && <button onClick={() => setView("activity")} className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl bg-[#ff455c] px-3 py-3 text-left text-xs font-black text-[#071116]"><span className="flex items-center gap-2"><Camera size={17} />CAPTURE REVIEW REQUIRED — confirm or dispute the photo.</span><span className="rounded-md bg-black/15 px-2 py-1 text-[10px]">REVIEW</span></button>}
      {view === "map" && <>
        <div className="mb-3 grid gap-3 sm:grid-cols-[1.4fr_.6fr]"><StatusCard label="DO THIS NEXT" value={nextAction.title} note={nextAction.note} /><StatusCard label="FIELD TIMER" value={pingIn ? `PING ${formatClock(pingIn)}` : "PING NOW"} note={viewer.videoSkipArmed ? "Video Skip armed." : videoPending ? `Video check opens in ${formatClock(Math.ceil((videoDueAt - Date.now()) / 1000))}.` : `${survivors} survivor${survivors === 1 ? "" : "s"} active.`} /></div>
        <TacticalMap center={{ lat: game.centerLat, lng: game.centerLng }} radius={game.currentRadius} points={data.points} players={data.players} trails={data.trails} items={data.items} currentPlayerId={viewer.id} currentLocation={currentLocation} />
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold"><Legend colour="bg-teal-300" text="SURVIVOR" /><Legend colour="bg-[#ff455c]" text="ZOMBIE" /><Legend colour="bg-[#f5cb55]" text="EXTRACTION" /><Legend colour="bg-[#a885ff]" text="POWER-UP" /><Legend colour="bg-slate-500" text="FROZEN PING" /></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{viewer.role === "zombie" ? <button onClick={() => { if (!captureCandidates.length) return toast.error("No active survivor is available to select."); setCaptureTarget(captureCandidates[0]); setMediaMode("photo"); }} disabled={headStart || viewer.status !== "active"} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><Camera size={19} />{photoUploading ? "SENDING CAPTURE…" : "CAPTURE PHOTO"}</button> : <button onClick={() => setMediaMode("video")} disabled={viewer.status !== "active"} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><FileVideo size={19} />{videoReady ? "RECORD REQUIRED VIDEO" : "RECORD FIELD VIDEO"}</button>}{viewer.isHost && <button onClick={() => perform(() => pause.mutateAsync({ ...safeSession, paused: game.status !== "paused" }))} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-black text-white transition hover:bg-white/10 active:scale-[0.98]"><CirclePause size={19} />{game.status === "paused" ? "RESUME GAME" : "PAUSE GAME"}</button>}</div>
        {viewer.role === "zombie" && captureCandidates.length > 1 && <div className="mt-3 flex flex-wrap gap-2"><span className="py-2 text-xs font-bold text-slate-500">CAPTURE TARGET:</span>{captureCandidates.map((candidate: any) => <button key={candidate.id} onClick={() => setCaptureTarget(candidate)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${captureTarget?.id === candidate.id ? "bg-[#ff455c] text-[#071116]" : "bg-white/5 text-slate-300"}`}><PlayerAvatar player={candidate} size="h-5 w-5" />{candidate.name}</button>)}</div>}
      </>}
      {view === "activity" && <ActivityPanel events={data.events} media={data.media} claims={currentClaims} viewer={viewer} onResolve={(claimId: string, resolution: "confirm" | "dispute" | "host_capture" | "host_dismiss") => perform(() => resolveCapture.mutateAsync({ ...safeSession, claimId, resolution }))} />}
      {view === "inventory" && <InventoryPanel viewer={viewer} items={data.items} onCollect={(itemId: string) => perform(() => collectItem.mutateAsync({ ...safeSession, itemId }))} onUse={() => perform(() => useItem.mutateAsync(safeSession))} />}
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#09151a]/95 px-4 py-2 backdrop-blur-md"><div className="mx-auto flex max-w-md justify-around">{[["map", Map, "MAP"], ["activity", Activity, "ACTIVITY"], ["inventory", PackageOpen, "INVENTORY"]].map(([id, Icon, label]) => { const SelectedIcon = Icon as typeof Map; return <button key={String(id)} onClick={() => setView(id as View)} className={`grid min-w-22 place-items-center gap-1 rounded-xl px-4 py-2 text-[10px] font-black tracking-[0.12em] ${view === id ? "bg-teal-300/15 text-teal-200" : "text-slate-500"}`}><SelectedIcon size={20} />{String(label)}</button>; })}</div></nav>
    {mediaMode && <MediaCapture mode={mediaMode} targetName={captureTarget?.name} onClose={() => { setMediaMode(null); setCaptureTarget(null); }} onComplete={uploadMedia} />}
  </main>;
}

function SetupScreen({ center, radius, minRadius, matchMinutes, points, pointMode, isHost, currentLocation, setInitial, setMinimum, setMatchMinutes, setPointMode, setPoints, onMapClick, onUseGps, onSave, busy }: any) {
  const [step, setStep] = useState(1);
  const extractionCount = points.filter((point: any) => point.type === "extraction").length;
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-5xl"><header className="mb-5 flex items-center justify-between"><div><div className="text-xs font-bold tracking-[0.16em] text-teal-200">HOST SETUP</div><h1 className="text-3xl font-black tracking-tight">BUILD THE PLAYING AREA</h1></div><div className="rounded-xl bg-[#ff455c] px-3 py-2 text-xs font-black text-[#071116]">STEP {step}/3</div></header>{!isHost ? <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-7 text-center"><Users className="mx-auto mb-3 text-teal-200" /><div className="font-black">Waiting for host setup</div><p className="mt-2 text-sm text-slate-400">The host is placing the safe zone and points.</p></div> : <><div className="mb-4 flex gap-2">{[[1, "PLAYING AREA"], [2, "POINTS"], [3, "RULES"]].map(([number, label]) => <button key={String(number)} onClick={() => setStep(Number(number))} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-black tracking-wide ${step === number ? "bg-teal-300 text-[#071116]" : "bg-white/5 text-slate-500"}`}>{String(label)}</button>)}</div><div className="grid gap-4 lg:grid-cols-[0.88fr_1.12fr]"><section className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5"><div className="mb-5 text-sm font-bold text-white">{step === 1 ? "Set a safe, walkable zone" : step === 2 ? "Place extraction and item points" : "Confirm the match rules"}</div>{step === 1 && <div className="space-y-4"><button onClick={() => void onUseGps()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/35 bg-teal-300/10 py-3 text-sm font-black text-teal-100"><Crosshair size={17} />SET CENTRE FROM GPS</button><RangeField label="Starting radius" value={radius} min={100} max={5_000} suffix="m" onChange={setInitial} /><RangeField label="Minimum radius" value={minRadius} min={50} max={radius} suffix="m" onChange={setMinimum} /><RangeField label="Match duration" value={matchMinutes} min={6} max={45} suffix="min" onChange={setMatchMinutes} /><p className="text-xs leading-5 text-slate-500">New games start at the University of Adelaide. Set a larger area—up to 5 km—or use your GPS location.</p></div>}{step === 2 && <div className="space-y-4"><div className="grid grid-cols-2 gap-2"><button onClick={() => setPointMode("extraction")} className={`rounded-xl p-3 text-xs font-black ${pointMode === "extraction" ? "bg-[#f5cb55] text-[#071116]" : "bg-white/5 text-slate-400"}`}>EXTRACTION</button><button onClick={() => setPointMode("powerup_candidate")} className={`rounded-xl p-3 text-xs font-black ${pointMode === "powerup_candidate" ? "bg-[#a885ff] text-[#071116]" : "bg-white/5 text-slate-400"}`}>POWER-UPS</button></div><p className="text-sm text-slate-300">Tap the map to add <strong>{pointMode === "extraction" ? "two to four potential extraction points" : "candidate power-up locations"}</strong>.</p><div className="rounded-xl border border-[#f5cb55]/20 bg-[#f5cb55]/5 p-3 text-xs leading-5 text-[#f9e29a]">In the final extraction window, the game randomly reveals two active exits from your {extractionCount} potential extraction point{extractionCount === 1 ? "" : "s"}.</div><div className="space-y-2">{points.length ? points.map((point: any, index: number) => <div key={`${point.label}-${index}`} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs"><span className={point.type === "extraction" ? "text-[#f5cb55]" : "text-[#a885ff]"}>{point.label}</span><button onClick={() => setPoints((current: any[]) => current.filter((_: any, itemIndex: number) => itemIndex !== index))} className="text-slate-500 hover:text-[#ff455c]"><X size={16} /></button></div>) : <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-500">No points yet.</div>}</div></div>}{step === 3 && <div className="space-y-4"><RuleRow label="Head start" value="45 seconds" /><RuleRow label="Match time" value={`${matchMinutes} minutes · adaptive ping cadence`} /><RuleRow label="Extraction" value="Two random exits reveal in the final window · hold 10 seconds" /><RuleRow label="Power drops" value="Random, team-labelled spawns throughout play" /><RuleRow label="Storm" value="15% contraction after 120 seconds without capture" /></div>}<button onClick={onSave} disabled={busy || extractionCount < 2} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40">{busy ? "SAVING..." : "SAVE & OPEN LOBBY"}<Flag size={17} /></button><p className="mt-2 text-center text-[11px] text-slate-500">Place 2–4 potential extraction points inside the minimum zone.</p></section><TacticalMap center={center} radius={radius} points={points} players={[]} trails={[]} items={[]} currentPlayerId="" currentLocation={currentLocation} onMapClick={onMapClick} /></div></>}</div></main>;
}

function PlayerAvatar({ player, size = "h-9 w-9" }: { player: any; size?: string }) {
  const initial = String(player.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  return <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full text-xs font-black ${size} ${player.role === "zombie" ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"}`}>
    {player.profileImageUrl ? <img src={player.profileImageUrl} alt={`${player.name} profile`} className="h-full w-full object-cover" /> : initial}
  </div>;
}

function BriefingModal({ game, onStart }: { game: any; onStart: () => void }) {
  const minutes = Math.round(game.rules.matchSeconds / 60);
  const extractAt = Math.round(game.rules.extractionOpensAtSeconds / 60);
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-lg rounded-t-[1.75rem] border border-teal-300/30 bg-[#09161b] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className="text-xs font-black tracking-[.17em] text-teal-200">MISSION BRIEFING</div><h2 className="mt-2 text-3xl font-black text-white">KNOW THE OBJECTIVE.</h2><div className="mt-5 grid gap-3"><div className="rounded-xl border border-teal-300/20 bg-teal-300/5 p-4"><div className="text-xs font-black text-teal-200">SURVIVORS</div><p className="mt-1 text-sm leading-5 text-slate-300">Stay inside the zone. Your location is hidden between pings. At minute {extractAt}, two random exits are revealed—hold an exit for 10 seconds to win.</p></div><div className="rounded-xl border border-[#ff455c]/25 bg-[#ff455c]/5 p-4"><div className="text-xs font-black text-[#ff9ba8]">ZOMBIES</div><p className="mt-1 text-sm leading-5 text-slate-300">Track survivor pings and trails. Photograph a survivor, then wait for their confirmation. Confirmed captures turn the final survivor and end the match.</p></div><div className="rounded-xl border border-[#a885ff]/25 bg-[#a885ff]/5 p-4 text-sm text-slate-300">Team-labelled power drops begin shortly after the match begins. Every major alert uses haptic feedback on supported phones.</div></div><button onClick={onStart} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-4 text-sm font-black text-[#071116] active:scale-[.98]"><Gamepad2 size={18} />BEGIN {minutes}-MINUTE MATCH</button></section></div>;
}

function LobbyScreen({ game, viewer, players, locationGranted, cameraGranted, permissionsBusy, onRequestPermissions, onReady, onAssign, onStart, onCopy, recoveryCode, onCopyRecovery, briefingOpen, onDismissBriefing }: any) {
  const allReady = players.length >= 2 && players.every((player: any) => player.isReady || player.isHost);
  const ready = players.find((player: any) => player.id === viewer.id)?.isReady;
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-lg pt-5"><div className="rounded-[1.5rem] border border-white/10 bg-[#0c1a20] p-6 shadow-2xl shadow-black/30"><div className="text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-300 text-[#071116]"><Radio size={25} /></div><div className="mt-4 text-xs font-bold tracking-[0.16em] text-teal-200">LOBBY OPEN</div><h1 className="mt-1 text-3xl font-black">ASSEMBLE THE TEAM</h1><button onClick={onCopy} className="mx-auto mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-2xl font-black tracking-[0.18em] text-white">{game.joinCode}<Copy size={16} className="text-teal-200" /></button></div><div className="mt-6 border-t border-white/10 pt-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold tracking-[0.12em] text-slate-500">PLAYERS ({players.length})</span><span className="text-xs font-bold text-teal-200">{players.filter((player: any) => player.isReady).length} READY</span></div><div className="space-y-2">{players.map((player: any) => <div key={player.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><PlayerAvatar player={player} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{player.name}{player.isHost ? <span className="ml-2 text-[10px] text-teal-200">HOST</span> : null}</div><div className="text-[10px] font-bold tracking-wide text-slate-500">{player.isReady ? "READY" : "NOT READY"} · {player.role.toUpperCase()}</div></div>{viewer.isHost && !player.isHost && <button onClick={() => onAssign(player.id, player.role !== "zombie")} className="rounded-lg bg-black/25 px-2 py-1.5 text-[10px] font-black text-slate-300">{player.role === "zombie" ? "MAKE SURVIVOR" : "MAKE ZOMBIE"}</button>}</div>)}</div></div><div className="mt-5 rounded-xl border border-teal-300/20 bg-teal-300/5 p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black text-teal-100">FIELD ACCESS</div><div className="mt-1 text-[11px] leading-4 text-slate-400">Allow precise location and camera before marking ready.</div></div><button onClick={() => void onRequestPermissions()} disabled={permissionsBusy} className="rounded-lg border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-[10px] font-black text-teal-100 disabled:opacity-50">{permissionsBusy ? "ASKING…" : "ALLOW"}</button></div><div className="mt-3 flex gap-2 text-[10px] font-bold"><span className={`rounded-full px-2 py-1 ${locationGranted ? "bg-teal-300 text-[#071116]" : "bg-white/10 text-slate-400"}`}>GPS {locationGranted ? "READY" : "REQUIRED"}</span><span className={`rounded-full px-2 py-1 ${cameraGranted ? "bg-teal-300 text-[#071116]" : "bg-white/10 text-slate-400"}`}>CAMERA {cameraGranted ? "READY" : "REQUIRED"}</span></div></div><div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><Info className="mr-1 inline h-4 w-4 align-text-bottom" />{Math.round(game.rules.matchSeconds / 60)} minutes · exits reveal at minute {Math.round(game.rules.extractionOpensAtSeconds / 60)} · power drops are team-labelled.</div><button onClick={() => void onReady()} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black ${ready ? "border border-teal-300/30 bg-teal-300/10 text-teal-100" : "bg-teal-300 text-[#071116]"}`}><Check size={18} />{ready ? "MARK NOT READY" : "ALLOW ACCESS & READY"}</button>{viewer.isHost && <button onClick={() => void onStart()} disabled={!allReady} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40"><Gamepad2 size={18} />VIEW BRIEFING & START</button>}<button onClick={onCopyRecovery} className="mt-5 flex w-full items-center justify-center gap-2 text-xs font-bold text-slate-500">YOUR RECOVERY CODE: <span className="font-mono text-slate-300">{recoveryCode}</span><Copy size={14} /></button></div></div>{briefingOpen && <BriefingModal game={game} onStart={onDismissBriefing} />}</main>;
}

function ActivityPanel({ events, media, claims, viewer, onResolve }: any) { return <section><div className="mb-4 flex items-center gap-2"><Activity className="text-teal-200" /><h2 className="text-xl font-black">FIELD ACTIVITY</h2></div>{claims.length > 0 && <div className="mb-4 space-y-3">{claims.map((claim: any) => { const evidence = media.find((entry: any) => entry.id === claim.mediaId); return <div key={claim.id} className="overflow-hidden rounded-2xl border border-[#ff455c]/40 bg-[#ff455c]/10"><div className="p-4"><div className="font-black text-[#ff8a98]">CAPTURE CLAIM {claim.status.toUpperCase()}</div><p className="mt-1 text-sm text-slate-200">A zombie submitted this photo. Confirm only if you are recognisably in frame.</p></div>{evidence?.kind === "photo" && <img src={evidence.url} alt="Capture evidence" className="max-h-80 w-full object-cover" />}<div className="p-4 pt-3"><div className="flex gap-2">{claim.targetPlayerId === viewer.id && claim.status === "pending" && <><button onClick={() => onResolve(claim.id, "confirm")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">CONFIRM CAPTURE</button><button onClick={() => onResolve(claim.id, "dispute")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISPUTE</button></>}{viewer.isHost && claim.status === "disputed" && <><button onClick={() => onResolve(claim.id, "host_capture")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">UPHOLD</button><button onClick={() => onResolve(claim.id, "host_dismiss")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISMISS</button></>}</div></div></div>; })}</div>}{media.length > 0 && <div className="mb-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">AUTHORISED MEDIA</h3><div className="flex gap-3 overflow-x-auto pb-2">{media.map((entry: any) => <div key={entry.id} className="min-w-40 overflow-hidden rounded-xl border border-white/10 bg-[#0c1a20]">{entry.kind === "photo" ? <img src={entry.url} className="h-26 w-40 object-cover" /> : <video src={entry.url} controls playsInline className="h-26 w-40 object-cover" />}<div className="p-2 text-[10px] font-bold text-slate-400">{entry.kind.toUpperCase()} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div>)}</div></div>}<div className="space-y-2">{events.map((event: any) => <div key={event.id} className="flex gap-3 rounded-xl border border-white/8 bg-[#0c1a20] p-3"><div className="mt-1 h-2 w-2 rounded-full bg-teal-300" /><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-200">{titleCase(event.type)}</div><div className="mt-1 text-xs text-slate-500">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div></div>)}</div></section>; }

function InventoryPanel({ viewer, items, onCollect, onUse }: any) { const item = viewer.inventory; return <section><div className="mb-4 flex items-center gap-2"><PackageOpen className="text-teal-200" /><h2 className="text-xl font-black">FIELD INVENTORY</h2></div><div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5">{item ? <><div className="text-xs font-bold tracking-[0.13em] text-teal-200">CARRIED ITEM</div><h3 className="mt-2 text-2xl font-black">{titleCase(item)}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{item === "hunt_scan" ? "Reveal frozen survivor snapshots to every active zombie." : item === "threat_scan" ? "Reveal frozen zombie snapshots to every survivor." : "Skip your next required video. Your location will still ping."}</p><button onClick={onUse} className="mt-5 w-full rounded-xl bg-teal-300 py-3 text-sm font-black text-[#071116]">{item === "video_skip" ? "ARM VIDEO SKIP" : "USE NOW"}</button></> : <><div className="text-xs font-bold tracking-[0.13em] text-slate-500">CARRIED ITEM</div><h3 className="mt-2 text-xl font-black text-slate-300">EMPTY</h3><p className="mt-2 text-sm text-slate-500">You can carry one item at a time. Collect only a drop labelled for your faction.</p></>}</div>{items.length > 0 && <div className="mt-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">LIVE POWER DROPS</h3><div className="space-y-2">{items.map((entry: any) => { const belongsToViewer = entry.faction === viewer.role; return <div key={entry.id} className={`flex items-center justify-between rounded-xl p-3 ${belongsToViewer ? "bg-teal-300/10" : "bg-[#ff455c]/10"}`}><div><div className="font-bold text-white">{titleCase(entry.type)}</div><div className={`text-xs font-black ${entry.faction === "zombie" ? "text-[#ff9ba8]" : "text-teal-200"}`}>{entry.faction === "zombie" ? "INFECTED DROP" : "SURVIVOR DROP"} · {belongsToViewer ? "YOUR TEAM CAN CLAIM" : "OTHER TEAM"}</div></div><button disabled={!!item || !belongsToViewer} onClick={() => onCollect(entry.id)} className="rounded-lg bg-[#a885ff] px-3 py-2 text-xs font-black text-[#071116] disabled:opacity-40">{belongsToViewer ? "COLLECT" : "LOCKED"}</button></div>; })}</div></div>}</section>; }

function StatusCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-4"><div className="text-[10px] font-bold tracking-[0.15em] text-slate-500">{label}</div><div className="mt-1 font-black text-white">{value}</div><div className="mt-1 text-xs leading-5 text-slate-500">{note}</div></div>; }
function AlertBanner({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: "red" | "amber" }) { return <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-black ${tone === "red" ? "bg-[#ff455c] text-[#071116]" : "bg-amber-300 text-[#071116]"}`}>{icon}{text}</div>; }
function Legend({ colour, text }: { colour: string; text: string }) { return <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-slate-400"><i className={`h-2 w-2 rounded-full ${colour}`} />{text}</span>; }
function RangeField({ label, value, min, max, suffix, onChange }: any) { return <label className="block"><div className="mb-2 flex justify-between text-xs font-bold text-slate-300"><span>{label}</span><span className="text-teal-200">{value} {suffix}</span></div><input type="range" value={value} min={min} max={max} step={10} onChange={event => onChange(Number(event.target.value))} className="w-full accent-teal-300" /></label>; }
function RuleRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-white/8 pb-3 text-sm"><span className="font-bold text-slate-300">{label}</span><span className="text-right text-slate-500">{value}</span></div>; }
