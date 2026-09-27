import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, Camera, Check, ChevronLeft, CirclePause, CircleStop, Compass, Copy, Crosshair, Download, FileVideo, Flag, Gamepad2, Info, Map, MapPin, PackageOpen, Pause, Play, Radio, ScanLine, ShieldAlert, Square, Timer, Users, Video, Wifi, WifiOff, X,
} from "lucide-react";
import { toast } from "sonner";
import TacticalMap from "@/components/TacticalMap";
import { clearGameSession, loadGameSession, type GameSession } from "@/lib/game-session";
import { fieldAudioEnabled, fieldHaptic as buzz, playFieldCue, unlockFieldAudio } from "@/lib/field-feedback";
import { trpc } from "@/lib/trpc";

type View = "map" | "activity" | "inventory";
type Snapshot = any;
type FieldAlert = { id: string; title: string; body: string; action?: "activity" };

const formatClock = (seconds: number) => `${String(Math.max(0, Math.floor(seconds / 60))).padStart(2, "0")}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
const timeValue = (value?: string | Date | null) => value ? new Date(value).getTime() : 0;
const titleCase = (value: string) => value.split("_").map(part => part[0]?.toUpperCase() + part.slice(1)).join(" ");
const metersApart = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => { const radians = (value: number) => value * Math.PI / 180; const dLat = radians(b.lat - a.lat); const dLng = radians(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2; return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
const primeAudio = () => { void unlockFieldAudio(); };
const tone = (kind: "ping" | "urgent" | "success" | "alert") => playFieldCue(kind);
const notify = (title: string, body: string) => { if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) new Notification(title, { body }); };
const reversePlace = async (lat?: number | null, lng?: number | null) => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  if (lat === null || lat === undefined || lng === null || lng === undefined || !token) return "field location";
  try {
    const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=street,neighborhood,place&access_token=${encodeURIComponent(token)}`);
    const result = await response.json();
    return result?.features?.[0]?.properties?.name ?? result?.features?.[0]?.text ?? "field location";
  } catch { return "field location"; }
};

function useLocalClock(start: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(interval); }, []);
  return now - start;
}

function HeadStartCountdown({ role, seconds, playerName, onEnableAudio }: { role: string; seconds: number; playerName: string; onEnableAudio: () => void }) {
  const survivor = role === "survivor";
  const elapsed = Math.max(0, 45 - seconds);
  const progress = Math.min(100, (elapsed / 45) * 100);
  const secondsLabel = seconds === 1 ? "SECOND" : "SECONDS";
  return <main className={`relative isolate grid min-h-screen overflow-hidden px-5 py-6 text-slate-100 ${survivor ? "bg-[#06151a]" : "bg-[#180a0f]"}`}>
    <div aria-hidden className={`absolute -left-28 -top-32 h-80 w-80 rounded-full blur-3xl ${survivor ? "bg-teal-300/15" : "bg-[#ff455c]/20"}`} />
    <div aria-hidden className={`absolute -bottom-48 -right-20 h-96 w-96 rounded-full blur-3xl ${survivor ? "bg-[#0a8190]/20" : "bg-amber-300/10"}`} />
    <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col justify-between">
      <header className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><div className={`grid h-11 w-11 place-items-center rounded-2xl ${survivor ? "bg-teal-300 text-[#071116]" : "bg-[#ff455c] text-[#071116]"}`}>{survivor ? <Compass size={22} /> : <ShieldAlert size={22} />}</div><div><div className={`text-[10px] font-black tracking-[.18em] ${survivor ? "text-teal-200" : "text-[#ff9ba8]"}`}>{survivor ? "SURVIVOR START WINDOW" : "INFECTED HOLD"}</div><div className="mt-1 text-xs font-bold text-slate-400">OUTBREAK: 24 · {playerName.toUpperCase()}</div></div></div><button onClick={onEnableAudio} className="rounded-xl border border-white/15 bg-black/15 px-3 py-2 text-[10px] font-black tracking-[.11em] text-slate-200 active:scale-[.98]">ENABLE SOUND</button></header>
      <section className="py-10 sm:py-16"><div className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black tracking-[.15em] ${survivor ? "border-teal-300/35 bg-teal-300/10 text-teal-100" : "border-[#ff455c]/40 bg-[#ff455c]/10 text-[#ff9ba8]"}`}><Radio size={13} className="animate-pulse" />MATCH LIVE · HEAD START ACTIVE</div><h1 className="max-w-md text-5xl font-black leading-[.88] tracking-[-.06em] sm:text-7xl">{survivor ? <>RUN.<br /><span className="text-teal-300">CREATE DISTANCE.</span></> : <>DON&apos;T<br /><span className="text-[#ff455c]">MOVE.</span></>}</h1><p className="mt-6 max-w-md text-base font-semibold leading-7 text-slate-300 sm:text-lg">{survivor ? "Create as much distance as you can. Zombies are locked out while your head start runs." : "Survivors have a head start. Your routes, trails, and capture tools unlock when this timer reaches zero."}</p></section>
      <section className={`rounded-[1.75rem] border p-5 shadow-2xl ${survivor ? "border-teal-300/25 bg-[#0a2025]/85" : "border-[#ff455c]/30 bg-[#240c12]/85"}`}><div className="flex items-end justify-between gap-3"><div><div className={`text-[10px] font-black tracking-[.16em] ${survivor ? "text-teal-200" : "text-[#ff9ba8]"}`}>{survivor ? "ZOMBIES BEGIN HUNTING YOU IN" : "CHASE UNLOCKS IN"}</div><div className="mt-2 font-mono text-6xl font-black tracking-[-.08em] text-white sm:text-7xl">{formatClock(seconds)}</div></div><div className={`mb-2 grid h-11 w-11 place-items-center rounded-2xl ${survivor ? "bg-teal-300/15 text-teal-200" : "bg-[#ff455c]/15 text-[#ff9ba8]"}`}><Timer size={23} /></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-black/30"><div className={`h-full rounded-full transition-[width] duration-700 ease-out ${survivor ? "bg-teal-300" : "bg-[#ff455c]"}`} style={{ width: `${progress}%` }} /></div><div className="mt-3 flex justify-between text-[10px] font-bold tracking-[.1em] text-slate-500"><span>{elapsed === 0 ? "START" : `${elapsed}s ELAPSED`}</span><span>{seconds} {secondsLabel} LEFT</span></div></section>
      <footer className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4"><div className="flex gap-3"><div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${survivor ? "bg-teal-300/10 text-teal-200" : "bg-[#ff455c]/10 text-[#ff9ba8]"}`}>{survivor ? <Play size={15} /> : <ScanLine size={15} />}</div><p className="text-xs font-semibold leading-5 text-slate-400">{survivor ? "Keep moving. Staying within a 15 m area for 30 seconds exposes your live position briefly." : "Use this time to plan. The first frozen survivor location ping broadcasts one minute after the match begins."}</p></div></footer>
    </div>
  </main>;
}

function HuntBeginsTransition({ role, seconds }: { role: string; seconds: number }) {
  const survivor = role === "survivor";
  const count = Math.max(1, Math.ceil(seconds));
  return <main className={`relative isolate grid min-h-screen place-items-center overflow-hidden p-6 text-center ${survivor ? "bg-[#06151a]" : "bg-[#180a0f]"}`}>
    <div aria-hidden className={`absolute h-[36rem] w-[36rem] rounded-full blur-3xl ${survivor ? "bg-teal-300/25" : "bg-[#ff455c]/30"}`} />
    <section className="relative z-10"><div className={`mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl ${survivor ? "bg-teal-300 text-[#071116]" : "bg-[#ff455c] text-[#071116]"}`}><Radio size={27} className="animate-pulse" /></div><div className={`text-[11px] font-black tracking-[.25em] ${survivor ? "text-teal-200" : "text-[#ff9ba8]"}`}>HEAD START COMPLETE</div><div className="mt-3 font-mono text-[10rem] font-black leading-none tracking-[-.12em] text-white sm:text-[14rem]">{count}</div><h1 className="mt-3 text-4xl font-black tracking-[-.05em] text-white sm:text-6xl">HUNT BEGINS.</h1><p className="mx-auto mt-4 max-w-sm text-sm font-bold leading-6 text-slate-300">{survivor ? "Keep moving. Infected routes, trails, and capture tools are now active." : "Move now. Survivor last-location pings and field tools are now live."}</p></section>
  </main>;
}

function MediaCapture({ mode, targetName, onClose, onComplete }: { mode: "photo" | "video"; targetName?: string; onClose: () => void; onComplete: (blob: Blob) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(3);
  const [captured, setCaptured] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let live = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      .then(stream => { if (!live) { stream.getTracks().forEach(track => track.stop()); return; } streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; })
      .catch(() => setError("Camera access is required. Check your browser permission, then try again."));
    return () => { live = false; if (recorderRef.current?.state === "recording") recorderRef.current.onstop = null; recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [mode]);

  const completeInBackground = (blob: Blob) => {
    setCaptured(true);
    buzz([18, 30, 18]); playFieldCue("success");
    streamRef.current?.getTracks().forEach(track => track.stop());
    onClose();
    window.setTimeout(() => onComplete(blob), 0);
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return setError("Camera is still starting. Try again in a moment.");
    buzz(18); playFieldCue("tap");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return setError("Could not process this photo.");
      // Capture is complete before the network work begins. Stop the camera and return the zombie to play instantly.
      setCaptured(true);
      setFlash(true);
      streamRef.current?.getTracks().forEach(track => track.stop());
      completeInBackground(blob);
    }, "image/jpeg", 0.88);
  };

  const record = () => {
    const stream = streamRef.current;
    if (!stream) return setError("Camera is still starting. Try again in a moment.");
    if (!window.MediaRecorder) return setError("This browser cannot record video. Use a current mobile browser.");
    buzz([25, 35, 25]); playFieldCue("urgent");
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_600_000 }) : new MediaRecorder(stream, { videoBitsPerSecond: 1_600_000 });
    recorderRef.current = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => completeInBackground(new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" }));
    recorder.start(250); setRecording(true); setRemaining(3);
    const countdown = window.setInterval(() => setRemaining(value => value - 1), 1_000);
    window.setTimeout(() => { window.clearInterval(countdown); if (recorder.state === "recording") recorder.stop(); }, 3_000);
  };

  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5">
    <div className="w-full max-w-md overflow-hidden rounded-t-[1.75rem] border border-white/10 bg-[#0a151a] shadow-2xl sm:rounded-[1.75rem]">
      <div className="flex items-center justify-between px-5 py-4"><div><div className="text-xs font-bold tracking-[0.14em] text-teal-200">{mode === "photo" ? "CAPTURE CONFIRMATION" : "PING EVIDENCE"}</div><div className="font-black text-white">{mode === "photo" ? `Photograph ${targetName ?? "target"}` : "Record a 3-second surroundings video"}</div></div><button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X size={20} /></button></div>
      <div className="relative aspect-[3/4] bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />{flash && <div className="absolute inset-0 bg-white/90" />}{recording && <div className="absolute inset-0 grid place-items-center bg-black/25"><div className="grid place-items-center gap-3 text-center"><div className="media-capture__turn"><Compass size={28} /></div><div className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#ff455c] bg-black/60 text-2xl font-black text-white">{remaining}</div><p className="max-w-48 text-xs font-black tracking-[.12em] text-white">TURN ONCE IN A FULL CIRCLE</p></div></div>}{error && <div className="absolute inset-x-4 bottom-4 rounded-xl bg-[#ff455c] p-3 text-sm font-bold text-[#071116]">{error}</div>}</div>
      <div className="p-5"><button disabled={recording || captured || !!error} onClick={mode === "photo" ? takePhoto : record} className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 py-3 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]">{mode === "photo" ? <Camera size={18} /> : <Video size={18} />}{captured ? "SENT IN BACKGROUND" : recording ? "RECORDING…" : mode === "photo" ? "TAKE PHOTO" : "START 3-SECOND VIDEO"}</button><p className="mt-3 text-center text-xs leading-5 text-slate-500">{mode === "photo" ? "The camera closes instantly. The capture request uploads in the background and alerts the survivor." : "Your camera closes after 3 seconds. The compact video uploads in the background and alerts every zombie when ready."}</p></div>
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
  const [setupVideoInterval, setSetupVideoInterval] = useState(3);
  const [setupPoints, setSetupPoints] = useState<Array<{ id?: string; type: "extraction" | "powerup_candidate"; label: string; lat: number; lng: number }>>([]);
  const [pointMode, setPointMode] = useState<"extraction" | "powerup_candidate">("extraction");
  const [setupHydrated, setSetupHydrated] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ kind: "photo" | "video"; state: "uploading" | "complete" | "error"; message: string } | null>(null);
  const [videoPromptOpen, setVideoPromptOpen] = useState(false);
  const [captureTargetPickerOpen, setCaptureTargetPickerOpen] = useState(false);
  const [zombieEvidence, setZombieEvidence] = useState<any[]>([]);
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [fieldAlerts, setFieldAlerts] = useState<FieldAlert[]>([]);
  const [soundReady, setSoundReady] = useState(() => fieldAudioEnabled());
  const lastReportedRef = useRef(0);
  const knownClaimIdsRef = useRef<Set<string>>(new Set());
  const latestEventIdRef = useRef<string | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const pingWarningRef = useRef<string | null>(null);
  const videoDeadlineWarningRef = useRef<string | null>(null);
  const shownEvidenceIdsRef = useRef<Set<string>>(new Set());
  const handledVideoDeadlineRef = useRef<string | null>(null);
  const headStartCueRef = useRef<number | null>(null);
  const huntCueRef = useRef<number | null>(null);
  const queueFieldAlert = (alert: FieldAlert) => setFieldAlerts(current => current.some(item => item.id === alert.id) ? current : [...current, alert].slice(-2));
  const dismissFieldAlert = () => setFieldAlerts(current => current.slice(1));
  const enableSound = async () => {
    const active = await unlockFieldAudio();
    setSoundReady(active);
    if (active) { buzz([12, 28, 12]); playFieldCue("success"); }
    return active;
  };
  const utils = trpc.useUtils();
  const snapshot = trpc.game.snapshot.useQuery(safeSession, { enabled: !!session, refetchInterval: 2_000, refetchIntervalInBackground: true, retry: 2, retryDelay: 800 });
  const data = snapshot.data as Snapshot | undefined;
  const snapshotAgeSeconds = data ? Math.max(0, Math.floor((Date.now() - snapshot.dataUpdatedAt) / 1_000)) : 0;
  const synchronizedHeadStartRemaining = data?.game ? Math.max(0, Number(data.game.headStartRemainingSeconds ?? 0) - snapshotAgeSeconds) : 0;
  const synchronizedHuntTransitionRemaining = data?.game ? Math.max(0, Number(data.game.huntTransitionSeconds ?? 0) - snapshotAgeSeconds) : 0;
  const clock = useLocalClock(data?.game?.startedAt ? timeValue(data.game.startedAt) : Date.now());
  const fieldNow = data?.game?.startedAt ? timeValue(data.game.startedAt) + clock : Date.now();
  const createSetup = trpc.game.saveSetup.useMutation();
  const setReady = trpc.game.setReady.useMutation();
  const assignZombie = trpc.game.assignZombie.useMutation();
  const openBriefing = trpc.game.openBriefing.useMutation();
  const start = trpc.game.start.useMutation();
  const pause = trpc.game.pause.useMutation();
  const stop = trpc.game.stop.useMutation();
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
    setSetupVideoInterval(Math.round((data.game.rules.videoIntervalSeconds ?? 180) / 60));
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
    }, () => queueFieldAlert({ id: "location-watch-error", title: "LOCATION SIGNAL LOST", body: "Move to open sky or check your location permission. The game pauses only if the signal does not recover." }), { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [session, data?.game?.status, locationGranted]);

  useEffect(() => {
    const targetClaims = data?.claims?.filter((claim: any) => claim.targetPlayerId === session?.playerId && claim.status === "pending") ?? [];
    const newClaim = targetClaims.find((claim: any) => !knownClaimIdsRef.current.has(claim.id));
    targetClaims.forEach((claim: any) => knownClaimIdsRef.current.add(claim.id));
    if (newClaim) {
      setView("activity");
      tone("urgent"); buzz([140, 65, 140, 65, 180]);
      queueFieldAlert({ id: `capture:${newClaim.id}`, title: "CAPTURE REVIEW REQUIRED", body: "A zombie submitted a photo. Review and confirm or dispute it now.", action: "activity" });
    }
  }, [data?.claims, session?.playerId]);

  useEffect(() => {
    const events = data?.events ?? [];
    if (!events.length) return;
    if (!latestEventIdRef.current) {
      events.forEach((event: any) => seenEventIdsRef.current.add(event.id));
      latestEventIdRef.current = events[0].id;
      return;
    }
    const alerts: Record<string, { buzz: number | number[]; tone: "ping" | "urgent" | "success" | "alert"; title: string; body: string; popup?: boolean }> = {
      match_started: { buzz: [100, 45, 100, 45, 160], tone: "urgent", title: "MATCH IS LIVE", body: "Survivors: create distance. Infected: do not move until the 45-second chase lock expires." },
      survivor_ping: { buzz: [30, 40, 30], tone: "ping", title: "SURVIVOR PING TRANSMITTED", body: "Fresh last-known locations are now on the infected map." },
      video_requested: { buzz: [110, 50, 110], tone: "urgent", title: "FIELD VIDEO REQUIRED", body: "Record a 3-second surroundings video within 30 seconds or one additional frozen ping is sent." },
      extraction_points_revealed: { buzz: [90, 55, 90, 55, 160], tone: "success", title: "EXTRACTIONS ARE OPEN", body: "Two extraction points are now live. Survivors can escape by holding an exit for 10 seconds.", popup: true },
      capture_requested: { buzz: [130, 60, 130], tone: "urgent", title: "CAPTURE REVIEW REQUIRED", body: "A capture photo needs a survivor response.", popup: true },
      capture_confirmed: { buzz: [80, 40, 80], tone: "alert", title: "SURVIVOR TURNING", body: "A capture was confirmed. The survivor is now converting to infected.", popup: true },
      powerup_spawned: { buzz: [45, 45, 45], tone: "success", title: "TEAM POWER-UP DEPLOYED", body: "A new power-up has spawned for your team. Open the map to claim it." },
      surroundings_video: { buzz: [35, 55, 35, 55, 100], tone: "urgent", title: "SURVIVOR VIDEO RECEIVED", body: "A new surroundings video is ready in Infected Intel." },
      video_missed_ping: { buzz: [150, 50, 150], tone: "urgent", title: "EXTRA LAST-LOCATION PING", body: "A survivor missed the recording deadline. One additional frozen location ping is live.", popup: true },
      camper_exposed: { buzz: [140, 45, 140, 45, 190], tone: "urgent", title: "CAMPER REVEALED", body: "A survivor stayed within a 15 m zone for 30 seconds. Their live position is visible for 20 seconds.", popup: true },
      camper_warning: { buzz: [140, 45, 140, 45, 190], tone: "urgent", title: "MOVE NOW", body: "You stayed within 15 m for 30 seconds. Your live location is visible to infected for 20 seconds.", popup: true },
      player_turned: { buzz: [90, 40, 90, 40, 150], tone: "alert", title: "PLAYER TURNED INFECTED", body: "A survivor conversion is complete.", popup: true },
      match_finished: { buzz: [180, 60, 180, 60, 260], tone: "success", title: "MATCH COMPLETE", body: "The result screen and match recap are ready.", popup: true },
      boundary_left: { buzz: [150, 55, 150, 55, 220], tone: "urgent", title: "OUT OF BOUNDS", body: "You left the playing area. Turn back immediately before the boundary penalty escalates.", popup: true },
      boundary_returned: { buzz: [30, 35, 70], tone: "success", title: "BACK IN BOUNDS", body: "You returned to the playing area. Boundary pressure has cleared." },
      boundary_forfeit: { buzz: [180, 60, 180, 60, 260], tone: "alert", title: "PLAYER FORFEITED", body: "A player remained outside the field for too long.", popup: true },
      storm_warning: { buzz: [50, 50, 50], tone: "alert", title: "ZONE SHRINK WARNING", body: "The field will contract in 30 seconds." },
      storm_contracting: { buzz: [70, 35, 70, 35, 120], tone: "alert", title: "ZONE IS SHRINKING", body: "The field is contracting now. Move inward.", popup: true },
      match_paused: { buzz: [80, 45, 80], tone: "alert", title: "GAME PAUSED", body: "The host has paused the game.", popup: true },
      match_resumed: { buzz: [35, 35, 80], tone: "success", title: "GAME RESUMED", body: "The host has resumed the game." },
      match_stopped: { buzz: [200, 60, 200, 60, 260], tone: "urgent", title: "HOST ENDED THE GAME", body: "The host has stopped this game for every player.", popup: true },
      lobby_cancelled: { buzz: [200, 60, 200, 60, 260], tone: "urgent", title: "HOST CANCELLED THE GAME", body: "The host cancelled this game.", popup: true },
      safety_pause: { buzz: [130, 50, 130], tone: "urgent", title: "SAFETY PAUSE", body: "The game is paused while a player location recovers.", popup: true },
    };
    const unseen = events.filter((event: any) => !seenEventIdsRef.current.has(event.id)).reverse();
    unseen.forEach((latest: any) => {
      const alert = alerts[latest.type];
      if (alert) {
        const body = latest.type === "storm_warning" ? `The field will shrink by ${Math.round(Number(latest.payload?.shrinkMeters ?? 0))} m in 30 seconds.` : latest.type === "storm_contracting" ? `The field is shrinking by ${Math.round(Number(latest.payload?.shrinkMeters ?? 0))} m now. Move inward.` : latest.type === "camper_exposed" ? `${latest.payload?.name ?? "A survivor"} was revealed for camping. Their live position is visible for 20 seconds.` : alert.body;
        buzz(alert.buzz); tone(alert.tone); notify(alert.title, body);
        if (alert.popup) queueFieldAlert({ id: `event:${latest.id}`, title: alert.title, body, action: latest.type === "capture_requested" ? "activity" : undefined });
      }
      seenEventIdsRef.current.add(latest.id);
    });
    if (seenEventIdsRef.current.size > 100) seenEventIdsRef.current = new Set(events.slice(0, 40).map((event: any) => event.id));
    latestEventIdRef.current = events[0].id;
  }, [data?.events]);

  useEffect(() => {
    const nextPingAt = timeValue(data?.game?.nextPingAt);
    const seconds = Math.ceil((nextPingAt - fieldNow) / 1000);
    if (data?.game?.status === "running" && seconds > 0 && seconds <= 10 && pingWarningRef.current !== String(nextPingAt)) {
      pingWarningRef.current = String(nextPingAt);
      buzz([25, 65, 25]); tone("ping"); notify("OUTBREAK: 24", `Survivor ping in ${seconds} seconds.`);
    }
  }, [data?.game?.nextPingAt, data?.game?.status, fieldNow]);

  useEffect(() => {
    const deadlineAt = timeValue(data?.viewer?.videoUploadDeadlineAt);
    const seconds = Math.ceil((deadlineAt - fieldNow) / 1000);
    if (data?.viewer?.role === "survivor" && deadlineAt && seconds > 0 && seconds <= 10 && videoDeadlineWarningRef.current !== String(deadlineAt)) {
      videoDeadlineWarningRef.current = String(deadlineAt);
      buzz([110, 50, 110]); tone("urgent"); notify("OUTBREAK: 24", `Upload your video within ${seconds} seconds or one extra last-location ping is sent.`);
    }
  }, [data?.viewer?.videoUploadDeadlineAt, data?.viewer?.role, fieldNow]);

  useEffect(() => {
    const deadlineAt = timeValue(data?.viewer?.videoUploadDeadlineAt);
    const dueAt = timeValue(data?.viewer?.videoDueAt);
    if (data?.viewer?.role === "survivor" && dueAt && dueAt <= fieldNow && deadlineAt > fieldNow && !mediaMode && handledVideoDeadlineRef.current !== String(deadlineAt)) {
      setVideoPromptOpen(true);
    } else if (!deadlineAt || deadlineAt <= fieldNow) {
      setVideoPromptOpen(false);
      handledVideoDeadlineRef.current = null;
    }
  }, [data?.viewer?.role, data?.viewer?.videoDueAt, data?.viewer?.videoUploadDeadlineAt, mediaMode, fieldNow]);

  useEffect(() => {
    if (data?.viewer?.role !== "zombie") return;
    const newEvidence = (data?.events ?? []).filter((event: any) => event.type === "surroundings_video" && event.payload?.mediaId && !shownEvidenceIdsRef.current.has(event.payload.mediaId));
    if (!newEvidence.length) return;
    newEvidence.forEach((event: any) => shownEvidenceIdsRef.current.add(event.payload.mediaId));
    void Promise.all(newEvidence.map(async (event: any) => ({
      ...event,
      media: data.media.find((entry: any) => entry.id === event.payload.mediaId),
      place: await reversePlace(event.payload?.lat, event.payload?.lng),
    }))).then(enriched => {
      const ready = enriched.filter((entry: any) => entry.media);
      if (!ready.length) return;
      setZombieEvidence(current => [...ready.reverse(), ...current].slice(0, 2));
      setEvidenceIndex(0);
      buzz([40, 55, 40, 55, 110]); tone("urgent"); notify("OUTBREAK: 24", `${ready[0].payload.name ?? "Survivor"} pinged near ${ready[0].place}.`);
    });
  }, [data?.events, data?.media, data?.viewer?.role]);

  useEffect(() => {
    const game = data?.game;
    if (!game?.startedAt || game.status !== "running") { headStartCueRef.current = null; huntCueRef.current = null; return; }
    const seconds = synchronizedHeadStartRemaining;
    if (seconds <= 0) {
      const huntCount = Math.max(0, Math.ceil(synchronizedHuntTransitionRemaining));
      if (huntCount > 0 && huntCueRef.current !== huntCount) {
        buzz([180, 55, 180, 55, 240]); tone("urgent"); huntCueRef.current = huntCount;
      } else if (huntCount === 0 && huntCueRef.current !== 0) {
        buzz([260, 60, 260, 60, 380]); tone("success"); huntCueRef.current = 0;
      }
      headStartCueRef.current = 0;
      return;
    }
    huntCueRef.current = null;
    const cue = seconds <= 5 || seconds % 5 === 0 ? seconds : null;
    if (cue !== null && cue !== headStartCueRef.current) {
      buzz(seconds <= 5 ? [75, 35, 75] : 30);
      tone(seconds <= 5 ? "urgent" : "ping");
      headStartCueRef.current = cue;
    }
  }, [data?.game?.startedAt, data?.game?.status, synchronizedHeadStartRemaining, synchronizedHuntTransitionRemaining]);

  const refresh = () => utils.game.snapshot.invalidate(safeSession);
  const saveSetup = async () => {
    try { await createSetup.mutateAsync({ ...safeSession, centerLat: setupCenter.lat, centerLng: setupCenter.lng, initialRadius: setupInitialRadius, minimumRadius: setupMinimumRadius, matchMinutes: setupMatchMinutes, videoIntervalMinutes: setupVideoInterval, points: setupPoints }); toast.success("Playing area saved. Lobby is open."); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save setup."); }
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
    // Audio must resume within a direct gesture on every device before automatic cues can play.
    await enableSound(); buzz(12); tone("ping");
    setPermissionsBusy(true);
    try {
      // Mobile browsers present permission sheets more reliably one after the other than in parallel.
      const location = await requestLocation();
      const camera = await requestCamera();
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission().then(permission => {
          if (permission === "granted") toast.success("Field notifications enabled.");
        });
      }
      primeAudio(); tone("success"); buzz([20, 25, 20]);
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
  const copy = async (value: string, label: string) => { primeAudio(); buzz(12); tone("ping"); await navigator.clipboard?.writeText(value); toast.success(`${label} copied.`); };
  const perform = async (operation: () => Promise<unknown>) => { try { primeAudio(); await operation(); buzz(16); tone("success"); refresh(); } catch (error) { buzz([60, 30, 60]); tone("alert"); const body = error instanceof Error ? error.message : "Command failed."; if (data?.game?.status === "running" || data?.game?.status === "paused") queueFieldAlert({ id: `command-error:${Date.now()}`, title: "FIELD ACTION FAILED", body }); else toast.error(body); } };
  const stopMatch = async () => { if (!window.confirm("End this game for every player? Everyone will receive a stop alert and be taken to the result screen.")) return; await perform(() => stop.mutateAsync(safeSession)); };
  const uploadMedia = async (blob: Blob, mode: "photo" | "video") => {
    if (!session) return;
    const isPhoto = mode === "photo";
    if (isPhoto) setPhotoUploading(true);
    setUploadStatus({ kind: mode, state: "uploading", message: isPhoto ? "Your camera is closed. The capture request is sending in the background." : "Your camera is closed. The 3-second field video is uploading in the background." });
    try {
      const response = await fetch("/api/game-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId: session.gameId, playerToken: session.playerToken, targetPlayerId: captureTarget?.id ?? null, kind: mode, dataUrl: await toDataUrl(blob), mimeType: blob.type || (isPhoto ? "image/jpeg" : "video/webm"), durationSeconds: mode === "video" ? 3 : null }) });
      const body = await response.json();
      if (!response.ok) { setUploadStatus({ kind: mode, state: "error", message: body.error ?? "Upload failed. Check your connection and try again." }); return; }
      setUploadStatus({ kind: mode, state: "complete", message: isPhoto ? "Capture request sent. Only the selected survivor has been alerted." : "Field video uploaded. Every active infected player has been notified." });
      refresh();
    } catch { setUploadStatus({ kind: mode, state: "error", message: "Upload failed. Check your connection and try again." }); }
    finally { if (isPhoto) setPhotoUploading(false); }
  };

  if (!session) return null;
  if (snapshot.error && !data) return <div className="grid min-h-screen place-items-center bg-[#071116] p-6 text-center text-slate-100"><div className="max-w-sm"><AlertTriangle className="mx-auto mb-3 text-[#ff455c]" /><h1 className="text-xl font-black">FIELD LINK INTERRUPTED</h1><p className="mt-2 text-sm leading-6 text-slate-400">{snapshot.error.message}</p><p className="mt-2 text-xs leading-5 text-slate-500">Your match has not been deleted. Retry first; only restore your session if the interruption continues.</p><button onClick={() => void snapshot.refetch()} className="mt-6 w-full rounded-xl bg-teal-300 px-4 py-3 text-sm font-black text-[#071116]">RETRY CONNECTION</button><button onClick={() => { clearGameSession(); navigate("/"); }} className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-xs font-black text-slate-200">RETURN HOME</button></div></div>;
  if (snapshot.isLoading || !data) return <div className="grid min-h-screen place-items-center bg-[#071116] text-teal-200"><div className="text-center"><Radio className="mx-auto mb-3 animate-pulse" /><div className="text-sm font-bold tracking-[0.18em]">CONNECTING TO FIELD OPS</div></div></div>;

  const game = data.game;
  const viewer = data.viewer;
  const player = data.players.find((entry: any) => entry.id === viewer.id);
  const elapsed = game.status === "running" ? Math.max(0, Math.floor((clock / 1000) - game.pausedSeconds)) : game.elapsedSeconds;
  const remaining = Math.max(0, game.rules.matchSeconds - elapsed);
  const survivors = data.players.filter((entry: any) => entry.role === "survivor" && entry.status === "active").length;
  const headStart = game.status === "running" && synchronizedHeadStartRemaining > 0;
  const headStartRemaining = headStart ? synchronizedHeadStartRemaining : 0;
  const huntTransition = game.status === "running" && !headStart && synchronizedHuntTransitionRemaining > 0;
  const extractionOpen = elapsed >= game.rules.extractionOpensAtSeconds;
  const pingIn = Math.max(0, Math.round((timeValue(game.nextPingAt) - fieldNow) / 1000));
  const videoIn = Math.max(0, Math.round((timeValue(game.nextVideoAt) - fieldNow) / 1000));
  const videoDueAt = timeValue(viewer.videoDueAt);
  const videoDeadlineAt = timeValue(viewer.videoUploadDeadlineAt);
  const videoReady = Boolean(videoDueAt && videoDueAt <= fieldNow && videoDeadlineAt > fieldNow);
  const videoPending = Boolean(videoDueAt && videoDueAt > fieldNow);
  const currentClaims = data.claims.filter((claim: any) => claim.status === "pending" || claim.status === "disputed");
  const pendingReviewClaim = data.claims.find((claim: any) => claim.targetPlayerId === viewer.id && claim.status === "pending");
  const captureCandidates = data.players.filter((entry: any) => entry.role === "survivor" && entry.status === "active" && entry.id !== viewer.id);
  const nearbyExtraction = viewer.role === "survivor" && currentLocation ? data.points.find((point: any) => point.type === "extraction" && point.isActive && metersApart(currentLocation, point) <= 28) : null;
  const nearbyPowerup = currentLocation ? data.items.find((item: any) => item.faction === viewer.role && metersApart(currentLocation, item) <= 34) : null;
  const nextEvent = viewer.role === "survivor" && videoReady
    ? { label: "VIDEO DEADLINE", timer: formatClock(Math.ceil((videoDeadlineAt - fieldNow) / 1000)) }
    : viewer.role === "zombie" && headStart
      ? { label: "DO NOT MOVE", timer: formatClock(headStartRemaining) }
      : videoIn > 0 && videoIn < pingIn
        ? { label: "VIDEO CHECK", timer: formatClock(videoIn) }
    : extractionOpen
      ? { label: "MATCH ENDS", timer: formatClock(remaining) }
      : { label: "NEXT PING", timer: formatClock(pingIn) };
  const nextAction = pendingReviewClaim
    ? { title: "REVIEW CAPTURE PHOTO", note: "Open Activity and confirm or dispute the evidence now." }
    : viewer.role === "survivor" && videoReady
      ? { title: "RECORD REQUIRED VIDEO", note: "Record a 3-second field video within 30 seconds or one additional last-location ping is sent." }
      : viewer.role === "survivor" && extractionOpen
        ? { title: "REACH A REVEALED EXIT", note: "Gold exits are live. Hold inside one for 10 seconds to escape." }
        : viewer.role === "survivor" && headStart
          ? { title: "CREATE DISTANCE", note: `Use your ${formatClock(headStartRemaining)} head start before infected begin hunting.` }
          : viewer.role === "zombie" && headStart
            ? { title: "DO NOT MOVE", note: `Chasing, routes, trails, and captures unlock in ${formatClock(headStartRemaining)}.` }
            : viewer.role === "zombie"
              ? { title: "TRACK THE NEXT PING", note: pingIn ? `Survivor portrait pings arrive in ${formatClock(pingIn)}. Follow trails or take a capture photo.` : "A new survivor ping is being transmitted." }
              : { title: "STAY MOVING", note: `Exits unlock in ${formatClock(game.rules.extractionOpensAtSeconds - elapsed)}. Team power drops will appear on your map.` };
  const activeFieldAlert = fieldAlerts[0];

  if (game.status === "setup") return <SetupScreen center={setupCenter} radius={setupInitialRadius} minRadius={setupMinimumRadius} matchMinutes={setupMatchMinutes} videoInterval={setupVideoInterval} points={setupPoints} pointMode={pointMode} isHost={viewer.isHost} currentLocation={currentLocation} setCenter={setSetupCenter} setInitial={setSetupInitialRadius} setMinimum={setSetupMinimumRadius} setMatchMinutes={setSetupMatchMinutes} setVideoInterval={setSetupVideoInterval} setPointMode={setPointMode} setPoints={setSetupPoints} onMapClick={addPoint} onUseGps={requestLocation} onSave={saveSetup} onStop={stopMatch} busy={createSetup.isPending} />;
  if (game.status === "lobby") return <LobbyScreen game={game} viewer={viewer} players={data.players} locationGranted={locationGranted} cameraGranted={cameraGranted} permissionsBusy={permissionsBusy} onRequestPermissions={requestFieldPermissions} onReady={async () => { await enableSound(); buzz(10); tone("ping"); if (!locationGranted || !cameraGranted) { const granted = await requestFieldPermissions(); if (!granted) return; } await perform(() => setReady.mutateAsync({ ...safeSession, isReady: !player?.isReady })); }} onAssign={(playerId: string, isZombie: boolean) => perform(() => assignZombie.mutateAsync({ ...safeSession, playerId, isZombie }))} onStart={() => perform(() => openBriefing.mutateAsync(safeSession))} onStop={stopMatch} onCopy={() => copy(game.joinCode, "Join code")} recoveryCode={session.rejoinCode} onCopyRecovery={() => copy(session.rejoinCode, "Recovery code")} briefingOpen={Boolean(game.briefingOpenedAt)} onDismissBriefing={() => void perform(() => start.mutateAsync(safeSession))} />;
  if (game.status === "finished") return <MatchResultScreen game={game} viewer={viewer} players={data.players} recap={data.recap} onReturn={() => { clearGameSession(); navigate("/"); }} />;
  if (game.status === "running" && headStart) return <HeadStartCountdown role={viewer.role} seconds={headStartRemaining} playerName={viewer.name} onEnableAudio={() => { void enableSound(); }} />;
  if (huntTransition) return <HuntBeginsTransition role={viewer.role} seconds={synchronizedHuntTransitionRemaining} />;

  return <main className="min-h-screen bg-[#071116] text-slate-100">
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#071116]/95 px-4 py-3 backdrop-blur-md"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><button onClick={() => { clearGameSession(); navigate("/"); }} className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><ChevronLeft size={20} /></button><PlayerAvatar player={player ?? viewer} size="h-9 w-9" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${game.status === "paused" ? "bg-amber-300" : "bg-teal-300"}`} /><span className="truncate text-xs font-black tracking-[0.16em]">{viewer.role === "zombie" ? "INFECTED OPS" : "SURVIVOR OPS"}</span></div><div className="mt-1 text-[10px] font-bold text-slate-500">CODE {game.joinCode} · {survivors} SURVIVOR{survivors === 1 ? "" : "S"} ACTIVE</div></div><div className="flex gap-2"><button onClick={() => void enableSound()} className={`rounded-xl border px-2 py-1.5 text-[8px] font-black tracking-[.1em] ${soundReady ? "border-teal-300/30 bg-teal-300/10 text-teal-200" : "border-amber-300/35 bg-amber-300/10 text-amber-100"}`}>{soundReady ? "SFX ON" : "SOUND"}</button><div className="rounded-xl border border-teal-300/20 bg-teal-300/5 px-2 py-1.5 text-right"><div className="text-[8px] font-bold tracking-[0.12em] text-teal-200">{nextEvent.label}</div><div className="font-mono text-sm font-black text-white">{nextEvent.timer}</div></div><div className="rounded-xl border border-white/10 bg-[#0c1a20] px-3 py-1.5 text-right"><div className="text-[9px] font-bold tracking-[0.15em] text-slate-500">MATCH TIME</div><div className="font-mono text-lg font-black text-white">{formatClock(remaining)}</div></div></div></div></header>
    <div className="mx-auto max-w-5xl p-4 pb-28">
      {game.status === "paused" && <AlertBanner tone="amber" icon={<Pause size={17} />} text="GAME PAUSED — host must resume after the field team recovers." />}
      {viewer.boundaryOutsideSince && <AlertBanner tone="red" icon={<AlertTriangle size={17} />} text={player?.boundaryExposed ? "OUT OF BOUNDS — return to the safe zone or you will forfeit." : "OUT OF BOUNDS — turn back now before the boundary penalty escalates."} />}
      {player?.exposureUntil && timeValue(player.exposureUntil) > fieldNow && <AlertBanner tone="red" icon={<Wifi size={17} />} text="LIVE POSITION EXPOSED — move more than 15 m to break contact." />}
      {viewer.staleLocationSeconds > 45 && <AlertBanner tone="amber" icon={<WifiOff size={17} />} text={viewer.staleLocationSeconds > 180 ? "LOCATION STALE — the match is pausing for safety." : "LOCATION STALE — move to open sky or check GPS permissions."} />}
      {viewer.role === "survivor" && videoReady && <AlertBanner tone="red" icon={<Video size={17} />} text={`VIDEO DUE — record a 3-second surroundings clip within ${formatClock(Math.ceil((videoDeadlineAt - fieldNow) / 1000))} or one extra last-location ping is sent.`} />}
      {pendingReviewClaim && <button onClick={() => setView("activity")} className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl bg-[#ff455c] px-3 py-3 text-left text-xs font-black text-[#071116]"><span className="flex items-center gap-2"><Camera size={17} />CAPTURE REVIEW REQUIRED — confirm or dispute the photo.</span><span className="rounded-md bg-black/15 px-2 py-1 text-[10px]">REVIEW</span></button>}
      {view === "map" && <>
        <div className="mb-3 grid gap-3 sm:grid-cols-[1.4fr_.6fr]"><StatusCard label="DO THIS NEXT" value={nextAction.title} note={nextAction.note} /><StatusCard label="FIELD TIMER" value={pingIn ? `PING ${formatClock(pingIn)}` : "PING NOW"} note={viewer.videoSkipArmed ? "Video Skip armed." : videoPending ? `Video check opens in ${formatClock(Math.ceil((videoDueAt - Date.now()) / 1000))}.` : `${survivors} survivor${survivors === 1 ? "" : "s"} active.`} /></div>
        <TacticalMap center={{ lat: game.centerLat, lng: game.centerLng }} radius={game.currentRadius} points={data.points} players={data.players} trails={data.trails} items={data.items} currentPlayerId={viewer.id} currentLocation={currentLocation} />
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold"><Legend colour="bg-teal-300" text="SURVIVOR" /><Legend colour="bg-[#ff455c]" text="ZOMBIE" /><Legend colour="bg-[#f5cb55]" text="EXTRACTION" /><Legend colour="bg-[#a885ff]" text="POWER-UP" /><Legend colour="bg-slate-500" text="FROZEN PING" /></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{viewer.role === "zombie" ? <button onClick={() => { primeAudio(); if (!captureCandidates.length) return queueFieldAlert({ id: `capture-target:none:${Date.now()}`, title: "NO CAPTURE TARGET", body: "There is no active survivor available for a capture claim." }); setCaptureTargetPickerOpen(true); }} disabled={headStart || viewer.status !== "active"} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><Camera size={19} />{photoUploading ? "SENDING CAPTURE…" : captureTarget ? `CAPTURE ${captureTarget.name.toUpperCase()}` : "SELECT CAPTURE TARGET"}</button> : <button onClick={() => { primeAudio(); setMediaMode("video"); }} disabled={viewer.status !== "active" || !videoReady} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 text-sm font-black text-[#071116] transition disabled:opacity-40 active:scale-[0.98]"><FileVideo size={19} />{videoReady ? "RECORD REQUIRED VIDEO" : "VIDEO CHECK PENDING"}</button>}{viewer.isHost && <button onClick={() => perform(() => pause.mutateAsync({ ...safeSession, paused: game.status !== "paused" }))} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-black text-white transition hover:bg-white/10 active:scale-[0.98]"><CirclePause size={19} />{game.status === "paused" ? "RESUME GAME" : "PAUSE GAME"}</button>}</div>
        {(nearbyExtraction || nearbyPowerup) && <div className="mt-3 grid gap-3 sm:grid-cols-2">{nearbyExtraction && <button onClick={() => { if (!currentLocation) return; void perform(() => reportLocation.mutateAsync({ ...safeSession, ...currentLocation, accuracy: 8 })); }} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#f5cb55] px-4 text-sm font-black text-[#071116] active:scale-[0.98]"><Flag size={19} />EXTRACT & ESCAPE</button>}{nearbyPowerup && <button disabled={Boolean(viewer.inventory)} onClick={() => perform(() => collectItem.mutateAsync({ ...safeSession, itemId: nearbyPowerup.id }))} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#a885ff] px-4 text-sm font-black text-[#071116] disabled:opacity-45 active:scale-[0.98]"><PackageOpen size={19} />{viewer.inventory ? "INVENTORY FULL" : "COLLECT POWER-UP"}</button>}</div>}
        {viewer.isHost && <button onClick={() => void stopMatch()} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#ff455c]/45 bg-[#ff455c]/10 px-4 text-xs font-black tracking-[.1em] text-[#ff9ba8] active:scale-[0.98]"><CircleStop size={17} />STOP GAME FOR EVERYONE</button>}
        {viewer.role === "zombie" && captureTarget && <button onClick={() => setCaptureTargetPickerOpen(true)} className="mt-3 flex items-center gap-2 rounded-xl border border-[#ff455c]/30 bg-[#ff455c]/8 px-3 py-2 text-xs font-black text-[#ffb0ba]"><PlayerAvatar player={captureTarget} size="h-6 w-6" />TARGETING {captureTarget.name.toUpperCase()} · CHANGE</button>}
      </>}
      {view === "activity" && <ActivityPanel events={data.events} media={data.media} claims={currentClaims} viewer={viewer} onResolve={(claimId: string, resolution: "confirm" | "dispute" | "host_capture" | "host_dismiss") => perform(() => resolveCapture.mutateAsync({ ...safeSession, claimId, resolution }))} />}
      {view === "inventory" && <InventoryPanel viewer={viewer} items={data.items} onCollect={(itemId: string) => perform(() => collectItem.mutateAsync({ ...safeSession, itemId }))} onUse={() => perform(() => useItem.mutateAsync(safeSession))} />}
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#09151a]/95 px-4 py-2 backdrop-blur-md"><div className="mx-auto flex max-w-md justify-around">{[["map", Map, "MAP"], ["activity", Activity, "ACTIVITY"], ["inventory", PackageOpen, "INVENTORY"]].map(([id, Icon, label]) => { const SelectedIcon = Icon as typeof Map; return <button key={String(id)} onClick={() => setView(id as View)} className={`grid min-w-22 place-items-center gap-1 rounded-xl px-4 py-2 text-[10px] font-black tracking-[0.12em] ${view === id ? "bg-teal-300/15 text-teal-200" : "text-slate-500"}`}><SelectedIcon size={20} />{String(label)}</button>; })}</div></nav>
    {videoPromptOpen && !mediaMode && <SurvivorVideoPrompt seconds={Math.max(0, Math.ceil((videoDeadlineAt - fieldNow) / 1000))} onDismiss={() => setVideoPromptOpen(false)} onRecord={() => { handledVideoDeadlineRef.current = String(videoDeadlineAt); setVideoPromptOpen(false); setMediaMode("video"); }} />}
    {viewer.role === "zombie" && zombieEvidence.length > 0 && <ZombieEvidenceModal evidence={zombieEvidence} index={Math.min(evidenceIndex, zombieEvidence.length - 1)} onClose={() => setZombieEvidence([])} onPrevious={() => setEvidenceIndex(index => (index - 1 + zombieEvidence.length) % zombieEvidence.length)} onNext={() => setEvidenceIndex(index => (index + 1) % zombieEvidence.length)} />}
    {captureTargetPickerOpen && <CaptureTargetModal candidates={captureCandidates} onClose={() => setCaptureTargetPickerOpen(false)} onSelect={target => { setCaptureTarget(target); setCaptureTargetPickerOpen(false); setMediaMode("photo"); }} />}
    {uploadStatus && <UploadStatusModal status={uploadStatus} onClose={() => setUploadStatus(null)} />}
    {activeFieldAlert && <UrgentNotice title={activeFieldAlert.title} body={activeFieldAlert.body} onClose={dismissFieldAlert} onOpenActivity={activeFieldAlert.action === "activity" ? () => { dismissFieldAlert(); setView("activity"); } : undefined} />}
    {mediaMode && <MediaCapture mode={mediaMode} targetName={captureTarget?.name} onClose={() => { setMediaMode(null); setCaptureTarget(null); }} onComplete={blob => { void uploadMedia(blob, mediaMode); }} />}
  </main>;
}

function SetupScreen({ center, radius, minRadius, matchMinutes, videoInterval, points, pointMode, isHost, currentLocation, setCenter, setInitial, setMinimum, setMatchMinutes, setVideoInterval, setPointMode, setPoints, onMapClick, onUseGps, onSave, onStop, busy }: any) {
  const [step, setStep] = useState(1);
  const [relocatingIndex, setRelocatingIndex] = useState<number | null>(null);
  const [movingCentre, setMovingCentre] = useState(false);
  const extractionCount = points.filter((point: any) => point.type === "extraction").length;
  const handleMapClick = (position: { lat: number; lng: number }) => {
    primeAudio(); buzz(14); tone("ping");
    if (movingCentre) { setCenter(position); setMovingCentre(false); toast.success("Playing-area centre moved."); return; }
    if (relocatingIndex !== null) {
      setPoints((current: any[]) => current.map((point, index) => index === relocatingIndex ? { ...point, lat: position.lat, lng: position.lng } : point));
      setRelocatingIndex(null); toast.success("Point relocated."); return;
    }
    onMapClick(position);
  };
  const modeNote = movingCentre ? "TAP THE MAP TO PLACE THE CENTRE" : relocatingIndex !== null ? `TAP THE MAP TO MOVE ${points[relocatingIndex]?.label ?? "THIS POINT"}` : step === 2 ? `TAP TO ADD ${pointMode === "extraction" ? "A POTENTIAL EXIT" : "A POWER-UP LOCATION"}` : "";
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-5xl"><header className="mb-5 flex items-center justify-between"><div><div className="text-xs font-bold tracking-[0.16em] text-teal-200">HOST SETUP</div><h1 className="text-3xl font-black tracking-tight">BUILD THE PLAYING AREA</h1></div><div className="rounded-xl bg-[#ff455c] px-3 py-2 text-xs font-black text-[#071116]">STEP {step}/3</div></header>{!isHost ? <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-7 text-center"><Users className="mx-auto mb-3 text-teal-200" /><div className="font-black">Waiting for host setup</div><p className="mt-2 text-sm text-slate-400">The host is placing the field boundary and points.</p></div> : <><div className="mb-4 flex gap-2">{[[1, "FIELD"], [2, "POINTS"], [3, "RULES"]].map(([number, label]) => <button key={String(number)} onClick={() => { primeAudio(); setMovingCentre(false); setRelocatingIndex(null); setStep(Number(number)); }} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-black tracking-wide ${step === number ? "bg-teal-300 text-[#071116]" : "bg-white/5 text-slate-500"}`}>{String(label)}</button>)}</div>{modeNote && <div className="mb-3 rounded-xl border border-teal-300/35 bg-teal-300/10 px-4 py-3 text-center text-xs font-black tracking-[.12em] text-teal-100">{modeNote}</div>}<div className="grid gap-4 lg:grid-cols-[0.88fr_1.12fr]"><section className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5"><div className="mb-5 text-sm font-bold text-white">{step === 1 ? "Choose the field centre and rounded-square boundary" : step === 2 ? "Place and relocate game points" : "Confirm match rules"}</div>{step === 1 && <div className="space-y-4"><button onClick={() => void onUseGps()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/35 bg-teal-300/10 py-3 text-sm font-black text-teal-100"><Crosshair size={17} />SET CENTRE FROM GPS</button><button onClick={() => { setMovingCentre(true); setRelocatingIndex(null); }} className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-black ${movingCentre ? "border-[#f5cb55] bg-[#f5cb55] text-[#071116]" : "border-white/15 bg-white/5 text-slate-100"}`}><MapPin size={17} />{movingCentre ? "TAP MAP TO PLACE CENTRE" : "PICK CENTRE ON MAP"}</button><RangeField label="Field half-width" value={radius} min={100} max={5_000} suffix="m" onChange={setInitial} /><RangeField label="Minimum half-width" value={minRadius} min={50} max={radius} suffix="m" onChange={setMinimum} /><RangeField label="Match duration" value={matchMinutes} min={6} max={45} suffix="min" step={1} onChange={setMatchMinutes} /><div className="rounded-xl border border-[#ff455c]/25 bg-[#ff455c]/8 p-3"><div className="text-[10px] font-black tracking-[.13em] text-[#ff9ba8]">SURVIVOR PING CADENCE</div><div className="mt-1 text-sm font-black text-white">EVERY 1 MINUTE</div><p className="mt-1 text-xs leading-5 text-slate-400">Each broadcast is a frozen last location—not live tracking.</p></div><RangeField label="Video check interval" value={videoInterval} min={1} max={10} suffix="min" step={1} onChange={setVideoInterval} /><p className="text-xs leading-5 text-slate-500">The field starts at the University of Adelaide, but you can pick any walkable centre. The teal boundary is a rounded square.</p></div>}{step === 2 && <div className="space-y-4"><div className="grid grid-cols-2 gap-2"><button onClick={() => { setPointMode("extraction"); setRelocatingIndex(null); }} className={`rounded-xl p-3 text-xs font-black ${pointMode === "extraction" ? "bg-[#f5cb55] text-[#071116]" : "bg-white/5 text-slate-400"}`}>EXTRACTION</button><button onClick={() => { setPointMode("powerup_candidate"); setRelocatingIndex(null); }} className={`rounded-xl p-3 text-xs font-black ${pointMode === "powerup_candidate" ? "bg-[#a885ff] text-[#071116]" : "bg-white/5 text-slate-400"}`}>POWER-UPS</button></div><p className="text-sm text-slate-300">Tap the map to add <strong>{pointMode === "extraction" ? "two to four potential extraction points" : "candidate power-up locations"}</strong>. Use <strong>MOVE</strong> to relocate any point before saving.</p><div className="rounded-xl border border-[#f5cb55]/20 bg-[#f5cb55]/5 p-3 text-xs leading-5 text-[#f9e29a]">The dashed gold rounded square is the smallest future zone. In the final extraction window, the game randomly reveals two active exits from your {extractionCount} potential extraction point{extractionCount === 1 ? "" : "s"}.</div><div className="space-y-2">{points.length ? points.map((point: any, index: number) => <div key={`${point.label}-${index}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${relocatingIndex === index ? "bg-[#f5cb55]/15 ring-1 ring-[#f5cb55]/60" : "bg-white/5"}`}><span className={`min-w-0 flex-1 truncate font-black ${point.type === "extraction" ? "text-[#f5cb55]" : "text-[#a885ff]"}`}>{point.label}</span><button onClick={() => { setMovingCentre(false); setRelocatingIndex(relocatingIndex === index ? null : index); }} className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-black text-slate-200">{relocatingIndex === index ? "CANCEL" : "MOVE"}</button><button onClick={() => setPoints((current: any[]) => current.filter((_: any, itemIndex: number) => itemIndex !== index))} className="text-slate-500 hover:text-[#ff455c]" aria-label={`Remove ${point.label}`}><X size={16} /></button></div>) : <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-500">No points yet.</div>}</div></div>}{step === 3 && <div className="space-y-4"><RuleRow label="Field shape" value={`Rounded square · ${radius * 2} m across`} /><RuleRow label="Head start" value="45 seconds" /><RuleRow label="Match time" value={`${matchMinutes} minutes`} /><RuleRow label="Ping cadence" value="Every 1 minute · frozen last location" /><RuleRow label="Video checks" value={`Every ${videoInterval} minute${videoInterval === 1 ? "" : "s"} · 30-second upload deadline`} /><RuleRow label="Extraction" value="Two random exits reveal in the final window · hold 10 seconds" /><RuleRow label="Power drops" value="Random, team-labelled spawns throughout play" /><RuleRow label="Storm" value="Begins after 5 minutes · contracts 15% after 120 seconds without capture" /></div>}<button onClick={onSave} disabled={busy || extractionCount < 2} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40">{busy ? "SAVING..." : "SAVE & OPEN LOBBY"}<Flag size={17} /></button><button onClick={() => void onStop()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#ff455c]/40 bg-[#ff455c]/10 py-3 text-xs font-black tracking-[.1em] text-[#ff9ba8]"><CircleStop size={16} />CANCEL GAME</button><p className="mt-2 text-center text-[11px] text-slate-500">Place 2–4 potential extraction points inside the dashed minimum rounded square.</p></section><TacticalMap center={center} radius={radius} minimumRadius={minRadius} points={points} players={[]} trails={[]} items={[]} currentPlayerId="" currentLocation={currentLocation} onMapClick={handleMapClick} setupFocus={step === 1 || step === 2} /></div></>}</div></main>;
}

function PlayerAvatar({ player, size = "h-9 w-9" }: { player: any; size?: string }) {
  const initial = String(player.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  return <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full text-xs font-black ${size} ${player.role === "zombie" ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"}`}>
    {player.profileImageUrl ? <img src={player.profileImageUrl} alt={`${player.name} profile`} className="h-full w-full object-cover" /> : initial}
  </div>;
}

function SurvivorVideoPrompt({ seconds, onRecord, onDismiss }: { seconds: number; onRecord: () => void; onDismiss: () => void }) {
  return <div className="fixed inset-0 z-40 grid place-items-end bg-black/75 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-md rounded-t-[1.75rem] border border-[#ff455c]/50 bg-[#121518] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className="flex items-start justify-between gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ff455c] text-[#071116]"><Video size={24} /></div><button onClick={onDismiss} className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Minimize video prompt"><X size={20} /></button></div><div className="mt-5 text-xs font-black tracking-[.16em] text-[#ff9ba8]">PING CHECK REQUIRED</div><h2 className="mt-2 text-3xl font-black text-white">SEND A 3-SECOND FIELD VIDEO.</h2><p className="mt-3 text-sm leading-6 text-slate-300">Turn once in a full circle while filming. Your compact video goes straight to infected ops when it uploads.</p><div className="mt-5 rounded-xl border border-[#ff455c]/25 bg-[#ff455c]/10 p-3"><div className="text-[10px] font-black tracking-[.14em] text-[#ff9ba8]">DEADLINE</div><div className="mt-1 font-mono text-2xl font-black text-white">{formatClock(seconds)}</div><p className="mt-1 text-xs text-slate-400">Missing it sends one extra last-location ping — never a live tracker.</p></div><button onClick={onRecord} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-4 text-sm font-black text-[#071116] active:scale-[.98]"><Video size={18} />RECORD NOW</button></section></div>;
}

function UrgentNotice({ title, body, onClose, onOpenActivity }: { title: string; body: string; onClose: () => void; onOpenActivity?: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-md rounded-t-[1.75rem] border border-[#ff455c]/50 bg-[#111619] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ff455c] text-[#071116]"><AlertTriangle size={25} /></div><div className="mt-5 text-xs font-black tracking-[.17em] text-[#ff9ba8]">IMMEDIATE FIELD ALERT</div><h2 className="mt-2 text-3xl font-black text-white">{title}</h2><p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>{onOpenActivity && <button onClick={onOpenActivity} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116]"><Activity size={18} />OPEN ACTIVITY</button>}<button onClick={onClose} className="mt-3 w-full rounded-xl border border-white/15 py-3 text-xs font-black text-slate-200">ACKNOWLEDGE</button></section></div>;
}

function CaptureTargetModal({ candidates, onClose, onSelect }: { candidates: any[]; onClose: () => void; onSelect: (target: any) => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-md rounded-t-[1.75rem] border border-[#ff455c]/50 bg-[#111619] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ff455c] text-[#071116]"><Camera size={24} /></div><div className="mt-5 text-xs font-black tracking-[.17em] text-[#ff9ba8]">CAPTURE CLAIM</div><h2 className="mt-2 text-3xl font-black text-white">WHO IS IN THE PHOTO?</h2><p className="mt-3 text-sm leading-6 text-slate-300">Choose the survivor visible in your photo before opening the camera. The selected player alone receives the review request.</p><div className="mt-5 grid gap-2">{candidates.map(candidate => <button key={candidate.id} onClick={() => onSelect(candidate)} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-[#ff455c]/65 hover:bg-[#ff455c]/10 active:scale-[.98]"><PlayerAvatar player={candidate} size="h-10 w-10" /><div className="min-w-0"><div className="truncate text-sm font-black text-white">{candidate.name}</div><div className="mt-0.5 text-[10px] font-bold tracking-[.1em] text-[#ff9ba8]">SEND CAPTURE REVIEW TO THIS SURVIVOR</div></div></button>)}</div><button onClick={onClose} className="mt-4 w-full rounded-xl border border-white/15 py-3 text-xs font-black text-slate-200">CANCEL</button></section></div>;
}

function UploadStatusModal({ status, onClose }: { status: { kind: "photo" | "video"; state: "uploading" | "complete" | "error"; message: string }; onClose: () => void }) {
  const isError = status.state === "error";
  const isComplete = status.state === "complete";
  const heading = status.state === "uploading" ? "UPLOADING IN BACKGROUND" : isComplete ? "UPLOAD COMPLETE" : "UPLOAD FAILED";
  return <div className="fixed inset-0 z-[60] grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-md rounded-t-[1.75rem] border border-white/15 bg-[#111619] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className={`grid h-12 w-12 place-items-center rounded-2xl ${isError ? "bg-[#ff455c] text-[#071116]" : isComplete ? "bg-teal-300 text-[#071116]" : "bg-[#f5cb55] text-[#071116]"}`}>{status.state === "uploading" ? <Wifi className="animate-pulse" size={24} /> : isError ? <AlertTriangle size={24} /> : <Check size={24} />}</div><div className={`mt-5 text-xs font-black tracking-[.17em] ${isError ? "text-[#ff9ba8]" : isComplete ? "text-teal-200" : "text-[#f9e29a]"}`}>{status.kind === "photo" ? "CAPTURE PHOTO" : "FIELD VIDEO"}</div><h2 className="mt-2 text-3xl font-black text-white">{heading}</h2><p className="mt-3 text-sm leading-6 text-slate-300">{status.message}</p>{status.state === "uploading" ? <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#f5cb55]" /></div> : <button onClick={onClose} className={`mt-6 w-full rounded-xl py-3 text-xs font-black ${isError ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"}`}>{isError ? "TRY AGAIN LATER" : "CONTINUE"}</button>}<button onClick={onClose} className="mt-3 w-full rounded-xl border border-white/15 py-3 text-xs font-black text-slate-200">{status.state === "uploading" ? "KEEP PLAYING" : "DISMISS"}</button></section></div>;
}

function ZombieEvidenceModal({ evidence, index, onClose, onPrevious, onNext }: { evidence: any[]; index: number; onClose: () => void; onPrevious: () => void; onNext: () => void }) {
  const item = evidence[index];
  if (!item) return null;
  const name = item.payload?.name ?? "SURVIVOR";
  return <div className="fixed inset-0 z-40 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-lg overflow-hidden rounded-t-[1.75rem] border border-[#ff455c]/45 bg-[#0a151a] shadow-2xl sm:rounded-[1.75rem]"><div className="flex items-start justify-between px-5 py-4"><div><div className="text-xs font-black tracking-[.16em] text-[#ff9ba8]">INFECTED INTEL RECEIVED</div><h2 className="mt-1 text-2xl font-black text-white">{name.toUpperCase()} PINGED NEAR {String(item.place ?? "field location").toUpperCase()}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Close evidence"><X size={20} /></button></div><video src={item.media?.url} controls autoPlay playsInline className="max-h-[48vh] w-full bg-black object-contain" /><div className="p-5"><p className="text-sm leading-6 text-slate-300">The survivor uploaded a field video. Use this as a clue, not a live tracker.</p>{evidence.length > 1 && <div className="mt-4 flex items-center justify-between"><button onClick={onPrevious} className="rounded-lg border border-white/15 px-4 py-2 text-xs font-black text-slate-200">PREVIOUS</button><span className="text-xs font-bold text-slate-500">{index + 1} / {evidence.length}</span><button onClick={onNext} className="rounded-lg bg-[#ff455c] px-4 py-2 text-xs font-black text-[#071116]">NEXT</button></div>}<button onClick={onClose} className="mt-4 w-full rounded-xl bg-white/8 py-3 text-xs font-black text-slate-100">BACK TO HUNT</button></div></section></div>;
}

function MatchResultScreen({ game, viewer, players, recap, onReturn }: { game: any; viewer: any; players: any[]; recap?: any; onReturn: () => void }) {
  const endedByHost = !game.winner;
  const zombiesWon = game.winner === "zombies";
  const activeInfected = players.filter(player => player.role === "zombie").length;
  const totals = recap?.totals ?? { captures: 0, escaped: players.filter(player => player.status === "escaped").length, forfeited: players.filter(player => player.status === "forfeited").length, infected: activeInfected };
  const captures = recap?.captures ?? [];
  const playerById = new globalThis.Map<string, any>(players.map((player): [string, any] => [player.id, player]));
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><section className={`mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border p-6 shadow-2xl sm:p-7 ${endedByHost || zombiesWon ? "border-[#ff455c]/40 bg-[#171115]" : "border-teal-300/35 bg-[#09191b]"}`}><div className="flex items-start justify-between gap-4"><div><div className={`grid h-14 w-14 place-items-center rounded-2xl ${endedByHost || zombiesWon ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"}`}>{endedByHost ? <CircleStop size={28} /> : zombiesWon ? <ShieldAlert size={28} /> : <Flag size={28} />}</div><div className={`mt-6 text-xs font-black tracking-[.17em] ${endedByHost || zombiesWon ? "text-[#ff9ba8]" : "text-teal-200"}`}>MATCH COMPLETE</div><h1 className="mt-2 text-4xl font-black text-white">{endedByHost ? "GAME STOPPED." : zombiesWon ? "INFECTED WIN." : "SURVIVORS ESCAPED."}</h1><p className="mt-3 max-w-lg text-sm leading-6 text-slate-300">{endedByHost ? "The host ended this game for every player." : zombiesWon ? "Every survivor has been confirmed infected. The field is over." : "An extraction held long enough to end the outbreak."}</p></div><div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-right"><div className="text-[9px] font-black tracking-[.12em] text-slate-500">YOUR TEAM</div><div className="mt-1 text-xs font-black text-white">{viewer.role === "zombie" ? "INFECTED" : "SURVIVOR"}</div></div></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><ResultStat label="CAPTURES" value={totals.captures} tone="red" /><ResultStat label="INFECTED" value={totals.infected} tone="red" /><ResultStat label="ESCAPED" value={totals.escaped} tone="teal" /><ResultStat label="FORFEITED" value={totals.forfeited} tone="amber" /></div><div className="mt-7"><div className="flex items-center justify-between"><div><div className="text-xs font-black tracking-[.15em] text-slate-400">MATCH RECAP</div><h2 className="mt-1 text-2xl font-black text-white">CAPTURE LOG</h2></div><span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-black text-slate-400">{captures.length} CONFIRMED</span></div>{captures.length ? <div className="mt-3 space-y-2">{captures.map((capture: any, index: number) => { const zombie = { ...(playerById.get(capture.zombiePlayerId) ?? {}), name: capture.zombieName, role: "zombie" }; const survivor = { ...(playerById.get(capture.survivorPlayerId) ?? {}), name: capture.survivorName, role: "survivor" }; return <div key={capture.id} className="flex items-center gap-3 rounded-xl border border-[#ff455c]/20 bg-black/20 p-3"><div className="grid h-6 w-6 place-items-center rounded-full bg-[#ff455c]/20 text-[10px] font-black text-[#ff9ba8]">{captures.length - index}</div><PlayerAvatar player={zombie} size="h-8 w-8" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white">{capture.zombieName} <span className="text-[#ff9ba8]">CAPTURED</span> {capture.survivorName}</div><div className="mt-0.5 text-[10px] font-bold tracking-[.08em] text-slate-500">CONFIRMED {new Date(capture.happenedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div><PlayerAvatar player={survivor} size="h-8 w-8" /></div>; })}</div> : <div className="mt-3 rounded-xl border border-dashed border-white/12 bg-black/15 p-4 text-sm text-slate-400">No confirmed captures were recorded in this match.</div>}</div><div className="mt-7"><div className="text-xs font-black tracking-[.15em] text-slate-400">PLAYER OUTCOMES</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{players.map(player => <div key={player.id} className="flex items-center gap-3 rounded-xl bg-black/20 p-3"><PlayerAvatar player={player} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">{player.name}</div><div className={`text-[10px] font-black tracking-[.12em] ${player.status === "escaped" ? "text-teal-200" : player.role === "zombie" ? "text-[#ff9ba8]" : player.status === "forfeited" ? "text-amber-200" : "text-slate-500"}`}>{player.status === "escaped" ? "ESCAPED" : player.role === "zombie" ? "INFECTED" : player.status.toUpperCase()}</div></div></div>)}</div></div><button onClick={onReturn} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-4 text-sm font-black text-[#071116]"><ChevronLeft size={18} />RETURN TO OUTBREAK</button></section></main>;
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: "red" | "teal" | "amber" }) {
  const styles = tone === "red" ? "border-[#ff455c]/25 bg-[#ff455c]/8 text-[#ff9ba8]" : tone === "teal" ? "border-teal-300/25 bg-teal-300/8 text-teal-200" : "border-amber-300/25 bg-amber-300/8 text-amber-200";
  return <div className={`rounded-xl border p-3 ${styles}`}><div className="text-[9px] font-black tracking-[.12em]">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>;
}

function BriefingModal({ game, isHost, onStart }: { game: any; isHost: boolean; onStart: () => void }) {
  const minutes = Math.round(game.rules.matchSeconds / 60);
  const extractAt = Math.round(game.rules.extractionOpensAtSeconds / 60);
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/80 p-0 sm:place-items-center sm:p-5"><section className="w-full max-w-lg rounded-t-[1.75rem] border border-teal-300/30 bg-[#09161b] p-6 shadow-2xl sm:rounded-[1.75rem]"><div className="text-xs font-black tracking-[.17em] text-teal-200">MISSION BRIEFING · TEAM SYNC</div><h2 className="mt-2 text-3xl font-black text-white">KNOW THE OBJECTIVE.</h2><div className="mt-5 grid gap-3"><div className="rounded-xl border border-teal-300/20 bg-teal-300/5 p-4"><div className="text-xs font-black text-teal-200">SURVIVORS</div><p className="mt-1 text-sm leading-5 text-slate-300">Stay inside the zone. Your location is hidden between brief pings. At minute {extractAt}, two random exits are revealed—hold an exit for 10 seconds to win.</p></div><div className="rounded-xl border border-[#ff455c]/25 bg-[#ff455c]/5 p-4"><div className="text-xs font-black text-[#ff9ba8]">ZOMBIES</div><p className="mt-1 text-sm leading-5 text-slate-300">Track the last known survivor pings and trails. Photograph a survivor, then wait for their confirmation. When the final survivor is infected, the match ends.</p></div><div className="rounded-xl border border-[#a885ff]/25 bg-[#a885ff]/5 p-4 text-sm text-slate-300">When a survivor ping fires, a 30-second video deadline starts. Missing it sends one additional last-location ping—it never enables permanent live tracking. The red zone begins after minute 5.</div></div>{isHost ? <button onClick={onStart} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-4 text-sm font-black text-[#071116] active:scale-[.98]"><Gamepad2 size={18} />BEGIN {minutes}-MINUTE MATCH</button> : <div className="mt-6 rounded-xl border border-white/10 bg-white/5 py-4 text-center text-xs font-black tracking-[.14em] text-slate-300">BRIEFING SYNCED · WAITING FOR HOST TO START</div>}</section></div>;
}

function LobbyScreen({ game, viewer, players, locationGranted, cameraGranted, permissionsBusy, onRequestPermissions, onReady, onAssign, onStart, onStop, onCopy, recoveryCode, onCopyRecovery, briefingOpen, onDismissBriefing }: any) {
  const allReady = players.length >= 2 && players.every((player: any) => player.isReady);
  const ready = players.find((player: any) => player.id === viewer.id)?.isReady;
  return <main className="min-h-screen bg-[#071116] p-4 text-slate-100"><div className="mx-auto max-w-lg pt-5"><div className="rounded-[1.5rem] border border-white/10 bg-[#0c1a20] p-6 shadow-2xl shadow-black/30"><div className="text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-300 text-[#071116]"><Radio size={25} /></div><div className="mt-4 text-xs font-bold tracking-[0.16em] text-teal-200">LOBBY OPEN</div><h1 className="mt-1 text-3xl font-black">ASSEMBLE THE TEAM</h1><button onClick={onCopy} className="mx-auto mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-2xl font-black tracking-[0.18em] text-white">{game.joinCode}<Copy size={16} className="text-teal-200" /></button></div><div className="mt-6 border-t border-white/10 pt-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold tracking-[0.12em] text-slate-500">PLAYERS ({players.length}/6)</span><span className="text-xs font-bold text-teal-200">{players.filter((player: any) => player.isReady).length} READY</span></div><div className="space-y-2">{players.map((player: any) => <div key={player.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><PlayerAvatar player={player} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{player.name}{player.isHost ? <span className="ml-2 text-[10px] text-teal-200">HOST</span> : null}</div><div className="text-[10px] font-bold tracking-wide text-slate-500">{player.isReady ? "READY" : "NOT READY"} · {player.role.toUpperCase()}</div></div>{viewer.isHost && <button onClick={() => onAssign(player.id, player.role !== "zombie")} className={`rounded-lg px-2 py-1.5 text-[10px] font-black ${player.role === "zombie" ? "bg-teal-300/15 text-teal-100" : "bg-[#ff455c]/15 text-[#ff9ba8]"}`}>{player.role === "zombie" ? "MAKE SURVOR" : "MAKE ZOMBIE"}</button>}</div>)}</div></div><div className="mt-5 rounded-xl border border-teal-300/20 bg-teal-300/5 p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black text-teal-100">FIELD ACCESS</div><div className="mt-1 text-[11px] leading-4 text-slate-400">Allow precise location, camera, and alerts before marking ready.</div></div><button onClick={() => void onRequestPermissions()} disabled={permissionsBusy} className="rounded-lg border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-[10px] font-black text-teal-100 disabled:opacity-50">{permissionsBusy ? "ASKING…" : "ALLOW"}</button></div><div className="mt-3 flex gap-2 text-[10px] font-bold"><span className={`rounded-full px-2 py-1 ${locationGranted ? "bg-teal-300 text-[#071116]" : "bg-white/10 text-slate-400"}`}>GPS {locationGranted ? "READY" : "REQUIRED"}</span><span className={`rounded-full px-2 py-1 ${cameraGranted ? "bg-teal-300 text-[#071116]" : "bg-white/10 text-slate-400"}`}>CAMERA {cameraGranted ? "READY" : "REQUIRED"}</span></div></div><div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><Info className="mr-1 inline h-4 w-4 align-text-bottom" />{Math.round(game.rules.matchSeconds / 60)} minutes · 45-second infected chase lock · survivor pings every minute · video checks every {Math.round((game.rules.videoIntervalSeconds ?? 180) / 60)} minutes.</div><button onClick={() => void onReady()} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black ${ready ? "border border-teal-300/30 bg-teal-300/10 text-teal-100" : "bg-teal-300 text-[#071116]"}`}><Check size={18} />{ready ? "MARK NOT READY" : "ALLOW ACCESS & READY"}</button>{viewer.isHost && <><button onClick={() => void onStart()} disabled={!allReady || briefingOpen} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] py-3 text-sm font-black text-[#071116] disabled:opacity-40"><Gamepad2 size={18} />{briefingOpen ? "BRIEFING OPEN FOR TEAM" : "OPEN TEAM BRIEFING"}</button><button onClick={() => void onStop()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#ff455c]/40 bg-[#ff455c]/10 py-3 text-xs font-black tracking-[.1em] text-[#ff9ba8]"><CircleStop size={16} />CANCEL GAME</button></>}<button onClick={onCopyRecovery} className="mt-5 flex w-full items-center justify-center gap-2 text-xs font-bold text-slate-500">YOUR RECOVERY CODE: <span className="font-mono text-slate-300">{recoveryCode}</span><Copy size={14} /></button></div></div>{briefingOpen && <BriefingModal game={game} isHost={viewer.isHost} onStart={onDismissBriefing} />}</main>;
}

function ActivityPanel({ events, media, claims, viewer, onResolve }: any) { return <section><div className="mb-4 flex items-center gap-2"><Activity className="text-teal-200" /><h2 className="text-xl font-black">FIELD ACTIVITY</h2></div>{claims.length > 0 && <div className="mb-4 space-y-3">{claims.map((claim: any) => { const evidence = media.find((entry: any) => entry.id === claim.mediaId); return <div key={claim.id} className="overflow-hidden rounded-2xl border border-[#ff455c]/40 bg-[#ff455c]/10"><div className="p-4"><div className="font-black text-[#ff8a98]">CAPTURE CLAIM {claim.status.toUpperCase()}</div><p className="mt-1 text-sm text-slate-200">A zombie submitted this photo. Confirm only if you are recognisably in frame.</p></div>{evidence?.kind === "photo" && <img src={evidence.url} alt="Capture evidence" className="max-h-80 w-full object-cover" />}<div className="p-4 pt-3"><div className="flex gap-2">{claim.targetPlayerId === viewer.id && claim.status === "pending" && <><button onClick={() => onResolve(claim.id, "confirm")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">CONFIRM CAPTURE</button><button onClick={() => onResolve(claim.id, "dispute")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISPUTE</button></>}{viewer.isHost && claim.status === "disputed" && <><button onClick={() => onResolve(claim.id, "host_capture")} className="flex-1 rounded-lg bg-[#ff455c] py-2 text-xs font-black text-[#071116]">UPHOLD</button><button onClick={() => onResolve(claim.id, "host_dismiss")} className="flex-1 rounded-lg border border-white/15 py-2 text-xs font-black">DISMISS</button></>}</div></div></div>; })}</div>}{media.length > 0 && <div className="mb-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">AUTHORISED MEDIA</h3><div className="flex gap-3 overflow-x-auto pb-2">{media.map((entry: any) => <div key={entry.id} className="min-w-40 overflow-hidden rounded-xl border border-white/10 bg-[#0c1a20]">{entry.kind === "photo" ? <img src={entry.url} className="h-26 w-40 object-cover" /> : <video src={entry.url} controls playsInline className="h-26 w-40 object-cover" />}<div className="p-2 text-[10px] font-bold text-slate-400">{entry.kind.toUpperCase()} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div>)}</div></div>}<div className="space-y-2">{events.map((event: any) => <div key={event.id} className="flex gap-3 rounded-xl border border-white/8 bg-[#0c1a20] p-3"><div className="mt-1 h-2 w-2 rounded-full bg-teal-300" /><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-200">{titleCase(event.type)}</div><div className="mt-1 text-xs text-slate-500">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div></div>)}</div></section>; }

function InventoryPanel({ viewer, items, onCollect, onUse }: any) { const item = viewer.inventory; return <section><div className="mb-4 flex items-center gap-2"><PackageOpen className="text-teal-200" /><h2 className="text-xl font-black">FIELD INVENTORY</h2></div><div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-5">{item ? <><div className="text-xs font-bold tracking-[0.13em] text-teal-200">CARRIED ITEM</div><h3 className="mt-2 text-2xl font-black">{titleCase(item)}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{item === "hunt_scan" ? "Reveal frozen survivor snapshots to every active zombie." : item === "threat_scan" ? "Reveal frozen zombie snapshots to every survivor." : "Skip your next required video. Your location will still ping."}</p><button onClick={onUse} className="mt-5 w-full rounded-xl bg-teal-300 py-3 text-sm font-black text-[#071116]">{item === "video_skip" ? "ARM VIDEO SKIP" : "USE NOW"}</button></> : <><div className="text-xs font-bold tracking-[0.13em] text-slate-500">CARRIED ITEM</div><h3 className="mt-2 text-xl font-black text-slate-300">EMPTY</h3><p className="mt-2 text-sm text-slate-500">You can carry one item at a time. Collect only a drop labelled for your faction.</p></>}</div>{items.length > 0 && <div className="mt-5"><h3 className="mb-2 text-xs font-bold tracking-[0.13em] text-slate-500">LIVE POWER DROPS</h3><div className="space-y-2">{items.map((entry: any) => { const belongsToViewer = entry.faction === viewer.role; return <div key={entry.id} className={`flex items-center justify-between rounded-xl p-3 ${belongsToViewer ? "bg-teal-300/10" : "bg-[#ff455c]/10"}`}><div><div className="font-bold text-white">{titleCase(entry.type)}</div><div className={`text-xs font-black ${entry.faction === "zombie" ? "text-[#ff9ba8]" : "text-teal-200"}`}>{entry.faction === "zombie" ? "INFECTED DROP" : "SURVIVOR DROP"} · {belongsToViewer ? "YOUR TEAM CAN CLAIM" : "OTHER TEAM"}</div></div><button disabled={!!item || !belongsToViewer} onClick={() => onCollect(entry.id)} className="rounded-lg bg-[#a885ff] px-3 py-2 text-xs font-black text-[#071116] disabled:opacity-40">{belongsToViewer ? "COLLECT" : "LOCKED"}</button></div>; })}</div></div>}</section>; }

function StatusCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-white/10 bg-[#0c1a20] p-4"><div className="text-[10px] font-bold tracking-[0.15em] text-slate-500">{label}</div><div className="mt-1 font-black text-white">{value}</div><div className="mt-1 text-xs leading-5 text-slate-500">{note}</div></div>; }
function AlertBanner({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: "red" | "amber" }) { return <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-black ${tone === "red" ? "bg-[#ff455c] text-[#071116]" : "bg-amber-300 text-[#071116]"}`}>{icon}{text}</div>; }
function Legend({ colour, text }: { colour: string; text: string }) { return <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-slate-400"><i className={`h-2 w-2 rounded-full ${colour}`} />{text}</span>; }
function RangeField({ label, value, min, max, suffix, step = 10, onChange }: any) { return <label className="block"><div className="mb-2 flex justify-between text-xs font-bold text-slate-300"><span>{label}</span><span className="text-teal-200">{value} {suffix}</span></div><input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} className="w-full accent-teal-300" /></label>; }
function RuleRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-white/8 pb-3 text-sm"><span className="font-bold text-slate-300">{label}</span><span className="text-right text-slate-500">{value}</span></div>; }
