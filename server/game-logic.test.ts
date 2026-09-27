import { describe, expect, it } from "vitest";
import { buildMatchRecap, canViewSurvivorPing, deriveRules, distanceToSegmentMeters, effectiveStormRadius, headStartRemainingSeconds, isFinalSurvivorCapture, metersBetween, pingIntervalSeconds, roundedSquarePositionWithinBounds, scheduledPingIntervalSeconds, shouldExposeCamper, stormShrinkMeters } from "./game-logic";

describe("game rule utilities", () => {
  it("measures short outdoor distances", () => {
    expect(metersBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 })).toBeGreaterThan(110);
    expect(metersBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 })).toBeLessThan(112);
  });

  it("detects proximity to a zombie trail segment", () => {
    const distance = distanceToSegmentMeters(
      { lat: 37.0, lng: -122.00005 },
      { lat: 37.0, lng: -122.001 },
      { lat: 37.0, lng: -121.999 },
    );
    expect(distance).toBeLessThan(6);
  });

  it("uses the survivor-count ping intervals", () => {
    expect(pingIntervalSeconds(3, () => 0)).toBe(45);
    expect(pingIntervalSeconds(3, () => 0.999)).toBe(60);
    expect(pingIntervalSeconds(2, () => 0)).toBe(60);
    expect(pingIntervalSeconds(2, () => 0.999)).toBe(90);
    expect(pingIntervalSeconds(1, () => 0)).toBe(90);
    expect(pingIntervalSeconds(1, () => 0.999)).toBe(120);
  });

  it("derives late extraction and adaptive drops from host match duration", () => {
    const short = deriveRules(6);
    const long = deriveRules(30);
    expect(short.matchSeconds).toBe(360);
    expect(short.extractionOpensAtSeconds).toBeLessThan(short.matchSeconds);
    expect(short.powerupStartsAtSeconds).toBeLessThan(short.extractionOpensAtSeconds);
    expect(long.extractionOpensAtSeconds).toBeGreaterThan(short.extractionOpensAtSeconds);
    expect(long.powerupIntervalSeconds).toBeGreaterThanOrEqual(short.powerupIntervalSeconds);
    expect(short.stormStartsAtSeconds).toBe(300);
    expect(long.stormStartsAtSeconds).toBe(300);
  });

  it("uses minute pings and host-selected field-video checks", () => {
    const twoMinuteVideos = deriveRules(12, 2);
    const fiveMinuteVideos = deriveRules(12, 5);
    expect(scheduledPingIntervalSeconds(twoMinuteVideos, 3, () => 0)).toBe(60);
    expect(scheduledPingIntervalSeconds(fiveMinuteVideos, 1, () => 0.999)).toBe(60);
    expect(twoMinuteVideos.videoIntervalSeconds).toBe(120);
    expect(fiveMinuteVideos.videoIntervalSeconds).toBe(300);
  });

  it("contracts the zone continuously during the announced shrink", () => {
    const end = new Date("2026-01-01T00:00:30.000Z");
    const base = { currentRadius: 200, minimumRadius: 100, stormPhase: "contracting", stormPhaseEndsAt: end };
    expect(effectiveStormRadius(base, new Date("2026-01-01T00:00:00.000Z"))).toBe(200);
    expect(effectiveStormRadius(base, new Date("2026-01-01T00:00:15.000Z"))).toBe(185);
    expect(effectiveStormRadius(base, end)).toBe(170);
    expect(stormShrinkMeters(200, 100)).toBe(30);
    expect(stormShrinkMeters(120, 110)).toBe(10);
  });

  it("retains survivor pings for zombies while limiting survivor confirmations to ten seconds", () => {
    const pingedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:00:35.000Z");
    const shared = { targetId: "survivor-a", targetRole: "survivor", pingedAt, expiresAt };
    expect(canViewSurvivorPing({ ...shared, viewerId: "zombie-a", viewerRole: "zombie", now: new Date("2026-01-01T00:00:30.000Z") })).toBe(true);
    expect(canViewSurvivorPing({ ...shared, viewerId: "zombie-a", viewerRole: "zombie", now: new Date("2026-01-01T00:04:00.000Z") })).toBe(true);
    expect(canViewSurvivorPing({ ...shared, viewerId: "teammate-a", viewerRole: "survivor", now: new Date("2026-01-01T00:00:09.999Z") })).toBe(true);
    expect(canViewSurvivorPing({ ...shared, viewerId: "teammate-a", viewerRole: "survivor", now: new Date("2026-01-01T00:00:10.001Z") })).toBe(false);
    expect(canViewSurvivorPing({ ...shared, viewerId: "survivor-a", viewerRole: "survivor", now: new Date("2026-01-01T00:00:02.000Z") })).toBe(false);
  });

  it("uses a rounded-square boundary instead of a circular play area", () => {
    const center = { lat: 0, lng: 0 };
    // This diagonal position is inside a 100 m square but outside a 100 m circle.
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.0008, lng: 0.0008 }, 100)).toBe(true);
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.0011, lng: 0 }, 100)).toBe(false);
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.00088, lng: 0.00088 }, 100)).toBe(false);
  });

  it("locks infected actions for the head start and exposes stationary survivors", () => {
    expect(headStartRemainingSeconds(0, deriveRules(12))).toBe(45);
    expect(headStartRemainingSeconds(45, deriveRules(12))).toBe(0);
    const anchor = { lat: -34.92051, lng: 138.60456 };
    const started = new Date("2026-01-01T00:00:00.000Z");
    expect(shouldExposeCamper({ anchor, current: { lat: -34.92050, lng: 138.60457 }, anchoredAt: started, now: new Date("2026-01-01T00:00:29.999Z") })).toBe(false);
    expect(shouldExposeCamper({ anchor, current: { lat: -34.92050, lng: 138.60457 }, anchoredAt: started, now: new Date("2026-01-01T00:00:30.000Z") })).toBe(true);
    expect(shouldExposeCamper({ anchor, current: { lat: -34.92020, lng: 138.60456 }, anchoredAt: started, now: new Date("2026-01-01T00:00:35.000Z") })).toBe(false);
  });

  it("builds a capture recap from resolved authoritative claims", () => {
    const players = [
      { id: "z1", displayName: "Raven", role: "zombie", status: "active" },
      { id: "s1", displayName: "Nova", role: "zombie", status: "active" },
      { id: "s2", displayName: "Kite", role: "survivor", status: "escaped" },
      { id: "s3", displayName: "Echo", role: "survivor", status: "forfeited" },
    ];
    const recap = buildMatchRecap(players, [
      { id: "c1", zombiePlayerId: "z1", targetPlayerId: "s1", status: "resolved", resolution: "capture", createdAt: new Date("2026-01-01T00:01:00Z"), resolvedAt: new Date("2026-01-01T00:02:00Z") },
      { id: "c2", zombiePlayerId: "z1", targetPlayerId: "s2", status: "resolved", resolution: "dismissed", createdAt: new Date("2026-01-01T00:03:00Z"), resolvedAt: new Date("2026-01-01T00:04:00Z") },
    ]);
    expect(recap.totals).toMatchObject({ captures: 1, infected: 2, escaped: 1, forfeited: 1, survivorsRemaining: 0 });
    expect(recap.captures[0]).toMatchObject({ zombieName: "Raven", survivorName: "Nova" });
  });

  it("ends the match immediately when a confirmed capture removes the final survivor", () => {
    const players = [
      { id: "z1", role: "zombie", status: "active" },
      { id: "s1", role: "survivor", status: "active" },
    ];
    expect(isFinalSurvivorCapture(players, "s1")).toBe(true);
    expect(isFinalSurvivorCapture([...players, { id: "s2", role: "survivor", status: "turning" }], "s1")).toBe(false);
    expect(isFinalSurvivorCapture([...players, { id: "s2", role: "survivor", status: "escaped" }], "s1")).toBe(true);
  });
});
