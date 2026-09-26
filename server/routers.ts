import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { assignZombie, collectItem, createGame, gameSnapshot, joinGame, pauseGame, rejoinGame, reportLocation, resolveCapture, setReady, startGame, updateSetup, useItem } from "./db";

const sessionInput = z.object({ gameId: z.string().min(1), playerToken: z.string().min(20) });
const nameInput = z.string().trim().min(2, "Use at least two characters.").max(36, "Use 36 characters or fewer.");

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  game: router({
    create: publicProcedure.input(z.object({ displayName: nameInput })).mutation(({ input }) => createGame(input.displayName)),
    join: publicProcedure.input(z.object({ joinCode: z.string().trim().toUpperCase().length(6), displayName: nameInput })).mutation(({ input }) => joinGame(input.joinCode, input.displayName)),
    rejoin: publicProcedure.input(z.object({ joinCode: z.string().trim().toUpperCase().length(6), recoveryCode: z.string().trim().toUpperCase().length(10) })).mutation(({ input }) => rejoinGame(input.joinCode, input.recoveryCode)),
    snapshot: publicProcedure.input(sessionInput).query(({ input }) => gameSnapshot(input)),
    saveSetup: publicProcedure.input(sessionInput.extend({
      centerLat: z.number().gte(-90).lte(90),
      centerLng: z.number().gte(-180).lte(180),
      initialRadius: z.number().min(50).max(2_000),
      minimumRadius: z.number().min(25).max(1_500),
      points: z.array(z.object({ id: z.string().optional(), type: z.enum(["extraction", "powerup_candidate"]), label: z.string().min(1).max(32), lat: z.number(), lng: z.number() })).max(12),
    })).mutation(({ input }) => updateSetup(input, input)),
    setReady: publicProcedure.input(sessionInput.extend({ isReady: z.boolean() })).mutation(({ input }) => setReady(input, input.isReady)),
    assignZombie: publicProcedure.input(sessionInput.extend({ playerId: z.string(), isZombie: z.boolean() })).mutation(({ input }) => assignZombie(input, input.playerId, input.isZombie)),
    start: publicProcedure.input(sessionInput).mutation(({ input }) => startGame(input)),
    pause: publicProcedure.input(sessionInput.extend({ paused: z.boolean() })).mutation(({ input }) => pauseGame(input, input.paused)),
    reportLocation: publicProcedure.input(sessionInput.extend({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180), accuracy: z.number().min(0).max(5_000) })).mutation(({ input }) => reportLocation(input, input)),
    collectItem: publicProcedure.input(sessionInput.extend({ itemId: z.string() })).mutation(({ input }) => collectItem(input, input.itemId)),
    useItem: publicProcedure.input(sessionInput).mutation(({ input }) => useItem(input)),
    resolveCapture: publicProcedure.input(sessionInput.extend({ claimId: z.string(), resolution: z.enum(["confirm", "dispute", "host_capture", "host_dismiss"]) })).mutation(({ input }) => resolveCapture(input, input.claimId, input.resolution)),
  }),
});

export type AppRouter = typeof appRouter;
