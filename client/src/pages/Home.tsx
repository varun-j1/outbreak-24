import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Compass, Crosshair, Radio, ShieldAlert, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { saveGameSession } from "@/lib/game-session";

const fieldClass = "h-12 w-full rounded-xl border border-white/10 bg-[#0b161b] px-4 text-[15px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-teal-300/60 focus:ring-2 focus:ring-teal-300/10";

export default function Home() {
  const [, navigate] = useLocation();
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [rejoinCode, setRejoinCode] = useState("");
  const create = trpc.game.create.useMutation();
  const join = trpc.game.join.useMutation();
  const rejoin = trpc.game.rejoin.useMutation();

  const continueToGame = (session: { gameId: string; playerToken: string; playerId: string; joinCode: string; rejoinCode: string }) => {
    saveGameSession(session);
    navigate("/game");
  };

  const createGame = async () => {
    try { continueToGame(await create.mutateAsync({ displayName })); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create game."); }
  };
  const joinGame = async () => {
    try { continueToGame(await join.mutateAsync({ joinCode: joinCode.trim().toUpperCase(), displayName })); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not join game."); }
  };
  const recoverGame = async () => {
    try { continueToGame(await rejoin.mutateAsync({ joinCode: joinCode.trim().toUpperCase(), recoveryCode: rejoinCode.trim().toUpperCase() })); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not restore game."); }
  };

  return <main className="home-shell min-h-screen overflow-hidden bg-[#071116] text-slate-100">
    <div className="topographic absolute inset-0 opacity-40" />
    <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 md:px-8">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#ff455c] text-[#071116]"><ShieldAlert size={22} strokeWidth={2.8} /></div><div><div className="text-lg font-black tracking-[0.18em]">OUTBREAK</div><div className="text-[10px] font-bold tracking-[0.26em] text-teal-200">FIELD OPS // 24</div></div></div>
      <div className="hidden items-center gap-2 text-xs font-semibold text-slate-400 sm:flex"><Radio size={15} className="text-teal-300" /> LOCATION-BASED MULTIPLAYER</div>
    </header>

    <section className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-8 md:grid-cols-[1.1fr_0.9fr] md:px-8 md:pt-20">
      <div className="max-w-2xl self-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-bold tracking-wide text-teal-100"><span className="h-2 w-2 rounded-full bg-teal-300" /> LIVE FIELD PROTOTYPE</div>
        <h1 className="text-balance text-5xl font-black leading-[0.9] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">RUN THE <span className="text-[#ff455c]">ZONE.</span><br />OWN THE NIGHT.</h1>
        <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-slate-300">A four-player, real-world chase game. Survivors find an extraction. Zombies track pings, trails, and confirmed captures.</p>
        <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-center text-xs">
          {[[UsersRound, "2–8", "PLAYERS"], [Compass, "GPS", "TRACKING"], [Crosshair, "12 MIN", "MATCH"]].map(([Icon, value, label]) => { const FeatureIcon = Icon as typeof UsersRound; return <div key={String(label)} className="rounded-xl border border-white/8 bg-[#0b181e]/75 px-3 py-4"><FeatureIcon className="mx-auto mb-2 text-teal-200" size={20} /><div className="font-black text-white">{String(value)}</div><div className="mt-1 text-[9px] font-bold tracking-[0.16em] text-slate-500">{String(label)}</div></div>; })}
        </div>
        <p className="mt-6 max-w-xl text-xs leading-5 text-slate-500">Play outdoors in a safe, permitted area. Your browser will request location and camera only when the game needs them.</p>
      </div>

      <div className="relative rounded-[1.75rem] border border-white/10 bg-[#0b181e]/95 p-5 shadow-2xl shadow-black/40 sm:p-7">
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/60 to-transparent" />
        <div className="mb-6"><div className="text-xs font-bold tracking-[0.16em] text-teal-200">MISSION CONTROL</div><h2 className="mt-1 text-2xl font-black tracking-tight text-white">Start a match</h2></div>
        <label className="mb-2 block text-xs font-bold text-slate-300">YOUR CALLSIGN</label>
        <input className={fieldClass} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="e.g. NIGHT OWL" maxLength={36} />
        <button onClick={createGame} disabled={create.isPending || displayName.trim().length < 2} className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#ff455c] px-4 py-3 text-sm font-black text-[#091116] transition hover:bg-[#ff6577] disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]">{create.isPending ? "CREATING..." : "CREATE GAME"}<ArrowRight size={17} /></button>
        <div className="my-7 flex items-center gap-3 text-[10px] font-bold tracking-[0.16em] text-slate-600"><span className="h-px flex-1 bg-white/10" />OR JOIN FIELD TEAM<span className="h-px flex-1 bg-white/10" /></div>
        <label className="mb-2 block text-xs font-bold text-slate-300">SIX-CHARACTER JOIN CODE</label>
        <input className={`${fieldClass} font-mono uppercase tracking-[0.22em]`} value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} />
        <button onClick={joinGame} disabled={join.isPending || displayName.trim().length < 2 || joinCode.length !== 6} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-teal-300/35 bg-teal-300/10 px-4 text-sm font-black text-teal-100 transition hover:bg-teal-300/20 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]">{join.isPending ? "JOINING..." : "JOIN GAME"}<ArrowRight size={17} /></button>
        <details className="mt-5 border-t border-white/8 pt-4"><summary className="cursor-pointer text-xs font-bold text-slate-500">RESTORE A PLAYER SESSION</summary><div className="mt-3"><label className="mb-2 block text-xs font-bold text-slate-300">10-CHARACTER RECOVERY CODE</label><input className={`${fieldClass} font-mono uppercase tracking-[0.15em]`} value={rejoinCode} onChange={event => setRejoinCode(event.target.value.toUpperCase())} placeholder="YOUR CODE" maxLength={10} /><button onClick={recoverGame} disabled={rejoin.isPending || joinCode.length !== 6 || rejoinCode.length !== 10} className="mt-3 w-full text-sm font-bold text-teal-200 disabled:opacity-40">RESTORE SESSION</button></div></details>
      </div>
    </section>
  </main>;
}
