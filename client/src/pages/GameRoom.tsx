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

  useEffect(() => {
    let live = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: mode === "photo" ? "environment" : "environment" }, audio: mode === "video" })
      .then(stream => { if (!live) { stream.getTracks().forEach(track => track.stop()); return; } streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; })
      .catch(() => setError("Camera access is required. Check your browser permission, then try again."));
    return () => { live = false; streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [mode]);

  const finish = async (blob: Blob) => {
    setBusy(true);
    try { await onComplete(blob); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed. Please retry."); setBusy(false); }
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return setError("Camera is still starting. Try again in a moment.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(blob => blob ? finish(blob) : setError("Could not process this photo."), "image/jpeg", 0.88);
  };

  const record = () => {
    const stream = streamRef.current;
    if (!stream) return setError("Camera is still starting. Try again in a moment.");
    if (!window.MediaRecorder) return setError("This browser cannot record video. Use a current mobile browser.");
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm" });
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
      <div className="relative aspect-[3/4] bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />{recording && <div className="absolute inset-0 grid place-items-center bg-black/25"><div className="grid h-20 w-20 place-items-center rounded-full border-2 border-[#ff455c] bg-black/50 text-2xl font-black text-white">{remaining}</div></div>}{error && <div className="absolute inset-x-4 bottom-4 rounded-xl bg-[#ff455c] p-3 text-sm font-bold text-[#071116]">{error}</div>}</div>
      <div className="p-5"><button disabled={busy || recording || !!error} onClick={mode === "photo" ? takePhoto : record} className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 py-3 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]">{mode === "photo" ? <Camera size={18} /> : <Video size={18} />}{busy ? "UPLOADING..." : recording ? "RECORDING..." : mode === "photo" ? "TAKE PHOTO" : "START 5-SECOND VIDEO"}</button><p className="mt-3 text-center text-xs leading-5 text-slate-500">{mode === "photo" ? "Get recognisable head and torso in frame. The target may confirm or dispute." : "Only zombies and the host can view this surroundings video."}</p></div>
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
  const [setupCenter, setSetupCenter] = useState({ lat: 37.7749, lng: -122.4194 });
  const [setupInitialRadius, setSetupInitialRadius] = useState(240);
  const [setupMinimumRadius, setSetupMinimumRadius] = useState(100);
  const [setupPoints, setSetupPoints] = useState<Array<{ id?: string; type: "extraction" | "powerup_candidate"; label: string; lat: number; lng: number }>>([]);
  const [pointMode, setPointMode] = useState<"extraction" | "powerup_candidate">("extraction");
  const [setupHydrated, setSetupHydrated] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const lastReportedRef = useRef(0);
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
    setSetupPoints(data.points.map((point: any) => ({ id: point.id, type: point.type, label: point.label, lat: point.lat, lng: point.lng })));
    setSetupHydrated(true);
  }, [data, setupHydrated]);

  useEffect(() => {
    if (!session || data?.game?.status !== "running" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(position => {
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCurrentLocation(coordinates);
      if (Date.now() - lastReportedRef.current > 3_500) {
        lastReportedRef.current = Date.now();
        reportLocation.mutate({ ...safeSession, ...coordinates, accuracy: Math.round(position.coords.accuracy) });
      }
    }, () => toast.error("Location unavailable. Check permissions; gameplay has paused if it stays unavailable."), { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [session, data?.game?.status]);

  const refresh = () => utils.game.snapshot.invalidate(safeSession);
  const saveSetup = async () => {
    try { await createSetup.mutateAsync({ ...safeSession, centerLat: setupCenter.lat, centerLng: setupCenter.lng, initialRadius: setupInitialRadius, minimumRadius: setupMinimumRadius, points: setupPoints }); toast.success("Playing area saved. Lobby is open."); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save setup."); }
  };
  const requestLocation = () => navigator.geolocation?.getCurrentPosition(position => { setCurrentLocation({ lat: position.coords.latitude, lng: position.coords.longitude }); setSetupCenter({ lat: position.coords.latitude, lng: position.coords.longitude }); toast.success("Map centre set from your GPS location."); }, () => toast.error("Location could not be read."), { enableHighAccuracy: true, timeout: 10_000 });
  const addPoint = (position: { lat: number; lng: number }) => {
    if (!data?.viewer?.isHost || !(data.game.status === "setup" || data.game.status === "lobby")) return;
    if (pointMode === "extraction" && setupPoints.filter(point => point.type === "extraction").length >= 2) return toast.error("You already have two extraction points.");
    setSetupPoints(points => {
      const number = points.filter(point => point.type === pointMode).length + 1;
      return [...points, { type: pointMode, label: pointMode === "extraction" ? `EXTRACT ${number}` : `POWER ${number}`, lat: position.lat, lng: position.lng }];
    });
  };
  const copy = async (value: string, label: string) => { await navigator.clipboard?.writeText(value); toast.success(`${label} copied.`); };
  const perform = async (operation: () => Promise<unknown>) => { try { await operation(); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Command failed."); } };
  const uploadMedia = async (blob: Blob) => {
    if (!session || !mediaMode) return;
    const response = await fetch("/api/game-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId: session.gameId, playerToken: session.playerToken, targetPlayerId: captureTarget?.id ?? null, kind: mediaMode, dataUrl: await toDataUrl(blob), mimeType: blob.type || (mediaMode === "photo" ? "image/jpeg" : "video/webm"), durationSeconds: mediaMode === "video" ? 5 : null }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Upload failed.");
    toast.success(mediaMode === "photo" ? "Capture request sent to target." : "Surroundings video uploaded.");
    refresh();
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
  const captureCandidates = data.players.filter((entry: any) => entry.role === "survivor" && entry.status === "active" && entry.id !== viewer.id);

  if (game.status === "setup") return <SetupScreen center={setupCenter} radius={setupInitialRadius} minRadius={setupMinimumRadius} points={setupPoints} pointMode={pointMode} isHost={viewer.isHost} currentLocation={currentLocation} setInitial={setSetupInitialRadius} setMinimum={setSetupMinimumRadius} setPointMode={setPointMode} setPoints={setSetupPoints} onMapClick={addPoint} onUseGps={requestLocation} onSave={saveSetup} busy={createSetup.isPending} />;
  if (game.status === "lobby") return <LobbyScreen game={game} viewer={viewer} players={data.players} onReady={() => perform(() => setReady.mutateAsync({ ...safeSession, isReady: !player?.isReady }))} onAssign={(playerId: string, isZombie: boolean) => perform(() => assignZombie.mutateAsync({ ...safeSession, playerId, isZombie }))} onStart={() => perform(() => start.mutateAsync(safeSession))} onCopy={() => copy(game.joinCode, "Join code")} recoveryCode={session.rejoinCode} onCopyRecovery={() => copy(session.rejoinCode, "Recovery code")} />;

  return <main className="min-h-screen bg-[#071116] text-slate-100">
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#071116]/95 px-4 py-3 backdrop-blur-md"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><button onClick={() => { clearGameSession(); navigate("/"); }} className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><ChevronLeft size={20} /></button><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${game.status === "paused" ? "bg-amber-300" : "bg-teal-300"}`} /><span className="truncate text-xs font-black tracking-[0.16em]">{viewer.role === "zombie" ? "INFECTED OPS" : "SURVIVOR OPS"}</span></div><div className="mt-1 text-[10px] font-bold text-slate-500">CODE {game.joinCode} · {survivors} SURVIVOR{survivors === 1 ? "" : "S"} ACTIVE</div></div><div className="rounded-xl border border-white/10 bg-[#0c1a20] px-3 py-1.5 text-right"><div className="text-[9px] font-bold tracking-[0.15em] text-slate-500">MATCH TIME</div><div className="font-mono text-lg font-black text-white">{formatClock(remaining)}</div></div></div></header>
    <div className="mx-auto max-w-5xl p-4 pb-28">
      {game.status === "paused" && <AlertBanner tone="amber" icon={<Pause size={17} />} text="GAME PAUSED — host must resume after the field team recovers." />}
      {player?.boundaryExposed && <AlertBanner tone="red" icon={<AlertTriangle size={17} />} text="OUT OF BOUNDS — return to the safe zone or you will forfeit." />}
      {player?.exposureUntil && timeValue(player.exposureUntil) > Date.now() && <AlertBanner tone="red" icon={<Wifi size={17} />} text="LOCATION EXPOSED — infected can see your live marker." />}
      {viewer.staleLocationSeconds > 10 && <AlertBanner tone="amber" icon={<WifiOff size={17} />} text={viewer.staleLocationSeconds > 20 ? "LOCATION STALE — the match is pausing for safety." : "LOCATION STALE — move to open sky or check GPS permissions."} />}
      {viewer.role === "survivor" && videoReady && <AlertBanner tone="red" icon={<Video size={17} />} text="VIDEO DUE — record five seconds of your surroundings before the upload grace period ends." />}
      {view === "map" && <>
        <div className="mb-3 grid gap-3 sm:grid-cols-2"><StatusCard label="NEXT PING" value={pingIn ? `${formatClock(pingIn)} until reveal` : "PING IN PROGRESS"} note={viewer.videoSkipArmed ? "Video Skip armed — location still pings." : videoPending ? `Video recording opens in ${formatClock(Math.ceil((videoDueAt - Date.now()) / 1000))}.` : viewer.role === "survivor" ? "Record a five-second video only when due." : "Survivor locations are frozen snapshots."} /><StatusCard label="OBJECTIVE" value={viewer.role === "zombie" ? headStart ? "HOLD POSITION" : "HUNT SURVIVORS" : extractionOpen ? "REACH EXTRACTION" : `EXTRACTION OPENS ${formatClock(game.rules.extractionOpensAtSeconds - elapsed)}`} note={viewer.role === "zombie" ? headStart ? `Hunt begins in ${formatClock(game.rules.headStartSeconds - elapsed)}.` : "Confirm captures to turn survivors." : extractionOpen ? "Hold inside an extraction area for 10 seconds." : "Stay clear of infected ground."} /></div>
        <TacticalMap center={{ lat: game.centerLat, lng: game.centerLng }} radius={game.currentRadius} points={data.points} players={data.players} trails={data.trails} items={data.items} currentPlayerId={viewer.id} currentLocation={currentLocation} />
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold"><Legend colour="bg-teal-300" text="SURVIVOR" /><Legend colour="bg-[#ff455c]" text="ZOMBIE" /><Legend colour="bg-[#f5cb55]" text="EXTRACTION" /><Legend colour="bg-[#a885ff]" text="POWER-UP" /><Legend colour="bg-slate-500" text="FROZEN PING" /></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{viewer.role === "zombie" ? <button onClick={() => { if (!captureCandidates.length) return toast.error("No active survivor is available to select."); setCaptureTarget(captureCandidates[0]); setMediaMode("photo"); }} disabled={headStart || viewer.status !== "active"} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><Camera size={19} />CAPTURE PHOTO</button> : <button onClick={() => setMediaMode("video")} disabled={viewer.status !== "active" || !videoReady} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><FileVideo size={19} />{videoReady ? "RECORD REQUIRED VIDEO" : "VIDEO NOT DUE"}</button>}{viewer.isHost && <button onClick={() => perform(() => pause.mutateAsync({ ...safeSession, paused: game.status !== "paused" }))} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-black text-white transition hover:bg-white/10 active:scale-[0.98]"><CirclePause size={19} />{game.status === "paused" ? "RESUME GAME" : "PAUSE GAME"}</button>}</div>
        {viewer.role === "zombie" && captureCandidates.length > 1 && <div className="mt-3 flex flex-wrap gap-2"><span className="py-2 text-xs font-bold text-slate-500">CAPTURE TARGET:</span>{captureCandidates.map((candidate: any) => <button key={candidate.id} onClick={() => setCaptureTarget(candidate)} className={`rounded-lg px-3 py-2 text-xs font-bold ${captureTarget?.id === candidate.id ? "bg-[#ff455c] text-[#071116]" : "bg-white/5 text-slate-300"}`}>{candidate.name}</button>)}</div>}
      </>}
      {view === "activity" && <ActivityPanel events={data.events} media={data.media} claims={currentClaims} viewer={viewer} onResolve={(claimId: string, resolution: "confirm" | "dispute" | "host_capture" | "host_dismiss") => perform(() => resolveCapture.mutateAsync({ ...safeSession, claimId, resolution }))} />}
      {view === "inventory" && <InventoryPanel viewer={viewer} items={data.items} onCollect={(itemId: string) => perform(() => collectItem.mutateAsync({ ...safeSession, itemId }))} onUse={() => perform(() => useItem.mutateAsync(safeSession))} />}
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#09151a]/95 px-4 py-2 backdrop-blur-md"><div className="mx-auto flex max-w-md justify-around">{[["map", Map, "MAP"], ["activity", Activity, "ACTIVITY"], ["inventory", PackageOpen, "INVENTORY"]].map(([id, Icon, label]) => { const SelectedIcon = Icon as typeof Map; return <button key={String(id)} onClick={() => setView(id as View)} className={`grid min-w-22 place-items-center gap-1 rounded-xl px-4 py-2 text-[10px] font-black tracking-[0.12em] ${view === id ? "bg-teal-300/15 text-teal-200" : "text-slate-500"}`}><SelectedIcon size={20} />{String(label)}</button>; })}</div></nav>
    {mediaMode && <MediaCapture mode={mediaMode} targetName={captureTarget?.name} onClose={() => { setMediaMode(null); setCaptureTarget(null); }} onComplete={uploadMedia} />}
  </main>;
}

function SetupScreen({ center, radius, minRadius, points, pointMode, isHost, currentLocation, setInitial, setMinimum, setPointMode, setPoints, onMapClick, onUseGps, onSave, busy }: any) {
  const [step, setStep] = useState(1);
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-5xl"><header className="mb-5 flex items-center justify-between"><div><div className="text-xs font-bold tracking-[0.16em] text-teal-200">HOST SETUP</div><h1 className="text-3xl font-black tracking-tight">BUILD THE PLAYING AREA</h1></div><div className="rounded-xl bg-[#ff455c] px-3 py-2 text-xs font-black text-[#071116]">STEP {step}/3</div></header>{!isHost ? <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-7 text-center"><Users className="mx-auto mb-3 text-teal-200" /><div className="font-black">Waiting for host setup</div><p className="mt-2 text-sm text-slate-400">The host is placing the safe zone and points.</p></div> : <><div className="mb-4 flex gap-2">{[[1, "PLAYING AREA"], [2, "POINTS"], [3, "RULES"]].map(([number, label]) => <button key={String(number)} onClick={() => setStep(Number(number))} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-black tracking-wide ${step === number ? "bg-teal-300 text-[#071116]" : "bg-white/5 text-slate-500"}`}>{String(label)}</button>)}</div><div className="grid gap-4 lg:grid-cols-[0.88fr_1.12fr]"><section className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5"><div className="mb-5 text-sm font-bold text-white">{step === 1 ? "Set a safe, walkable zone" : step === 2 ? "Place extraction and item points" : "Confirm the default match rules"}</div>{step === 1 && <div className="space-y-4"><button onClick={onUseGps} className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/35 bg-teal-300/10 py-3 text-sm font-black text-teal-100"><Crosshair size={17} />SET CENTRE FROM GPS</button><RangeField label="Starting radius" value={radius} min={100} max={1_000} suffix="m" onChange={setInitial} /><RangeField label="Minimum radius" value={minRadius} min={50} max={radius} suffix="m" onChange={setMinimum} /><p className="text-xs leading-5 text-slate-500">Choose an outdoor space with clear boundaries. GPS uncertainty is tolerated in rule checks.</p></div>}{step === 2 && <div className="space-y-4"><div className="grid grid-cols-2 gap-2"><button onClick={() => setPointMode("extraction")} className={`rounded-xl p-3 text-xs font-black ${pointMode === "extraction" ? "bg-[#f5cb55] text-[#071116]" : "bg-white/5 text-slate-400"}`}>EXTRACTION</button><button onClick={() => setPointMode("powerup_candidate")} className={`rounded-xl p-3 text-xs font-black ${pointMode === "powerup_candidate" ? "bg-[#a885ff] text-[#071116]" : "bg-white/5 text-slate-400"}`}>POWER-UPS</button></div><p className="text-sm text-slate-300">Tap the map to add <strong>{pointMode === "extraction" ? "up to two extraction points" : "candidate power-up locations"}</strong>.</p><div className="space-y-2">{points.length ? points.map((point: any, index: number) => <div key={`${point.label}-${index}`} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs"><span className={point.type === "extraction" ? "text-[#f5cb55]" : "text-[#a885ff]"}>{point.label}</span><button onClick={() => setPoints((current: any[]) => current.filter((_: any, itemIndex: number) => itemIndex !== index))} className="text-slate-500 hover:text-[#ff455c]"><X size={16} /></button></div>) : <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-500">No points yet.</div>}</div></div>}{step === 3 && <div className="space-y-4"><RuleRow label="Head start" value="45 seconds" /><RuleRow label="Match time" value="12 minutes" /><RuleRow label="Extraction" value="Opens minute 10 · hold 10 seconds" /><RuleRow label="Storm" value="15% contraction after 120 seconds without capture" /><p className="text-xs leading-5 text-slate-500">Advanced timing is defined server-side for this prototype and can be made host-configurable before launch.</p></div>}<button onClick={onSave} disabled={busy || points.filter((point: any) => point.type === "extraction").length !== 2} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40">{busy ? "SAVING..." : "SAVE & OPEN LOBBY"}<Flag size={17} /></button><p className="mt-2 text-center text-[11px] text-slate-500">Two extraction points are required. They must be inside the minimum zone.</p></section><TacticalMap center={center} radius={radius} points={points} players={[]} trails={[]} items={[]} currentPlayerId="" currentLocation={currentLocation} onMapClick={onMapClick} /></div></>}</div></main>;
}

function LobbyScreen({ game, viewer, players, onReady, onAssign, onStart, onCopy, recoveryCode, onCopyRecovery }: any) {
  const allReady = players.length >= 2 && players.every((player: any) => player.isReady || player.isHost);
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-lg pt-5"><div className="rounded-[1.5rem] border border-white/10 bg-[#0c1a20] p-6 shadow-2xl shadow-black/30"><div className="text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-300 text-[#071116]"><Radio size={25} /></div><div className="mt-4 text-xs font-bold tracking-[0.16em] text-teal-200">LOBBY OPEN</div><h1 className="mt-1 text-3xl font-black">ASSEMBLE THE TEAM</h1><button onClick={onCopy} className="mx-auto mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-2xl font-black tracking-[0.18em] text-white">{game.joinCode}<Copy size={16} className="text-teal-200" /></button><p className="mt-2 text-xs text-slate-500">Share this code with field players.</p></div><div className="mt-6 border-t border-white/10 pt-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold tracking-[0.12em] text-slate-500">PLAYERS ({players.length})</span><span className="text-xs font-bold text-teal-200">{players.filter((player: any) => player.isReady).length} READY</span></div><div className="space-y-2">{players.map((player: any) => <div key={player.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><div className={`grid h-9 w-9 place-items-center rounded-full text-xs font-black ${player.role === "zombie" ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"}`}>{player.role === "zombie" ? "Z" : "S"}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{player.name}{player.isHost ? <span className="ml-2 text-[10px] text-teal-200">HOST</span> : null}</div><div className="text-[10px] font-bold tracking-wide text-slate-500">{player.isReady ? "READY" : "NOT READY"} · {player.role.toUpperCase()}</div></div>{viewer.isHost && !player.isHost && <button onClick={() => onAssign(player.id, player.role !== "zombie")} className="rounded-lg bg-black/25 px-2 py-1.5 text-[10px] font-black text-slate-300">{player.role === "zombie" ? "MAKE SURVIVOR" : "MAKE ZOMBIE"}</button>}</div>)}</div></div><div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><Info className="mr-1 inline h-4 w-4 align-text-bottom" />Keep this page open and allow location access when the match starts.</div><button onClick={onReady} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black ${players.find((player: any) => player.id === viewer.id)?.isReady ? "border border-teal-300/30 bg-teal-300/10 text-teal-100" : "bg-teal-300 text-[#071116]"}`}><Check size={18} />{players.find((player: any) => player.id === viewer.id)?.isReady ? "MARK NOT READY" : "I'M READY"}</button>{viewer.isHost && <button onClick={onStart} disabled={!allReady} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40"><Gamepad2 size={18} />START MATCH</button>}<button onClick={onCopyRecovery} className="mt-5 flex w-full items-center justify-center gap-2 text-xs font-bold text-slate-500">YOUR RECOVERY CODE: <span className="font-mono text-slate-300">{recoveryCode}</span><Copy size={14} /></button></div></div></main>;
}

function ActivityPanel({ events, media, claims, viewer, onResolve }: any) { return <section><div className="mb-4 flex items-center gap-2"><Activity className="text-teal-200" /><h2 className="text-xl font-black">FIELD ACTIVITY</h2></div>{claims.length > 0 && <div className="mb-4 space-y-3">{claims.map((claim: any) => <div key={claim.id} className="rounded-2xl border border-[#ff455c]/40 bg-[#ff455c]/10 p-4"><div className="font-black text-[#ff8a98]">CAPTURE CLAIM {claim.status.toUpperCase()}</div><p className="mt-1 text-sm text-slate-200">A zombie submitted a photo capture. Confirm only if you are recognisably in frame.</p><div className="mt-3 flex gap-2">{claim.targetPlayerId === viewer.id && claim.status === "pending" && <><button onClick={() => onResolve(claim.id, "confirm")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">CONFIRM</button><button onClick={() => onResolve(claim.id, "dispute")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISPUTE</button></>}{viewer.isHost && claim.status === "disputed" && <><button onClick={() => onResolve(claim.id, "host_capture")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">UPHOLD</button><button onClick={() => onResolve(claim.id, "host_dismiss")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISMISS</button></>}</div></div>)}</div>}{media.length > 0 && <div className="mb-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">AUTHORISED MEDIA</h3><div className="flex gap-3 overflow-x-auto pb-2">{media.map((entry: any) => <div key={entry.id} className="min-w-40 overflow-hidden rounded-xl border border-white/10 bg-[#0c1a20]">{entry.kind === "photo" ? <img src={entry.url} className="h-26 w-40 object-cover" /> : <video src={entry.url} controls playsInline className="h-26 w-40 object-cover" />}<div className="p-2 text-[10px] font-bold text-slate-400">{entry.kind.toUpperCase()} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div>)}</div></div>}<div className="space-y-2">{events.map((event: any) => <div key={event.id} className="flex gap-3 rounded-xl border border-white/8 bg-[#0c1a20] p-3"><div className="mt-1 h-2 w-2 rounded-full bg-teal-300" /><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-200">{titleCase(event.type)}</div><div className="mt-1 text-xs text-slate-500">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div></div>)}</div></section>; }

function InventoryPanel({ viewer, items, onCollect, onUse }: any) { const item = viewer.inventory; return <section><div className="mb-4 flex items-center gap-2"><PackageOpen className="text-teal-200" /><h2 className="text-xl font-black">FIELD INVENTORY</h2></div><div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5">{item ? <><div className="text-xs font-bold tracking-[0.13em] text-teal-200">CARRIED ITEM</div><h3 className="mt-2 text-2xl font-black">{titleCase(item)}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{item === "hunt_scan" ? "Reveal frozen survivor snapshots to every active zombie." : item === "threat_scan" ? "Reveal frozen zombie snapshots to every survivor." : "Skip your next required video. Your location will still ping."}</p><button onClick={onUse} className="mt-5 w-full rounded-xl bg-teal-300 py-3 text-sm font-black text-[#071116]">{item === "video_skip" ? "ARM VIDEO SKIP" : "USE NOW"}</button></> : <><div className="text-xs font-bold tracking-[0.13em] text-slate-500">CARRIED ITEM</div><h3 className="mt-2 text-xl font-black text-slate-300">EMPTY</h3><p className="mt-2 text-sm text-slate-500">You can carry one item at a time. Move close to a faction pickup, then collect it.</p></>}</div>{items.length > 0 && <div className="mt-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">VISIBLE PICKUPS</h3><div className="space-y-2">{items.map((entry: any) => <div key={entry.id} className="flex items-center justify-between rounded-xl bg-white/5 p-3"><div><div className="font-bold text-white">{titleCase(entry.type)}</div><div className="text-xs text-slate-500">Move within 30 m to collect</div></div><button disabled={!!item} onClick={() => onCollect(entry.id)} className="rounded-lg bg-[#a885ff] px-3 py-2 text-xs font-black text-[#071116] disabled:opacity-40">COLLECT</button></div>)}</div></div>}</section>; }

function StatusCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-4"><div className="text-[10px] font-bold tracking-[0.15em] text-slate-500">{label}</div><div className="mt-1 font-black text-white">{value}</div><div className="mt-1 text-xs leading-5 text-slate-500">{note}</div></div>; }
function AlertBanner({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: "red" | "amber" }) { return <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-black ${tone === "red" ? "bg-[#ff455c] text-[#071116]" : "bg-amber-300 text-[#071116]"}`}>{icon}{text}</div>; }
function Legend({ colour, text }: { colour: string; text: string }) { return <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-slate-400"><i className={`h-2 w-2 rounded-full ${colour}`} />{text}</span>; }
function RangeField({ label, value, min, max, suffix, onChange }: any) { return <label className="block"><div className="mb-2 flex justify-between text-xs font-bold text-slate-300"><span>{label}</span><span className="text-teal-200">{value} {suffix}</span></div><input type="range" value={value} min={min} max={max} step={10} onChange={event => onChange(Number(event.target.value))} className="w-full accent-teal-300" /></label>; }
function RuleRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-white/8 pb-3 text-sm"><span className="font-bold text-slate-300">{label}</span><span className="text-right text-slate-500">{value}</span></div>; }
