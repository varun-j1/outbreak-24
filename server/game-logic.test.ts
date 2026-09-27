import { describe, expect, it } from "vitest";
import { deriveRules, distanceToSegmentMeters, effectiveStormRadius, metersBetween, pingIntervalSeconds, roundedSquarePositionWithinBounds, scheduledPingIntervalSeconds } from "./game-logic";

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

  it("uses the host-selected ping interval when one is set", () => {
    const fixed = deriveRules(12, 3);
    const adaptive = deriveRules(12, 0);
    expect(scheduledPingIntervalSeconds(fixed, 3, () => 0)).toBe(180);
    expect(scheduledPingIntervalSeconds(adaptive, 3, () => 0)).toBe(pingIntervalSeconds(3, adaptive.matchSeconds, () => 0));
  });

  it("contracts the zone continuously during the announced shrink", () => {
    const end = new Date("2026-01-01T00:00:30.000Z");
    const base = { currentRadius: 200, minimumRadius: 100, stormPhase: "contracting", stormPhaseEndsAt: end };
    expect(effectiveStormRadius(base, new Date("2026-01-01T00:00:00.000Z"))).toBe(200);
    expect(effectiveStormRadius(base, new Date("2026-01-01T00:00:15.000Z"))).toBe(185);
    expect(effectiveStormRadius(base, end)).toBe(170);
  });

  it("uses a rounded-square boundary instead of a circular play area", () => {
    const center = { lat: 0, lng: 0 };
    // This diagonal position is inside a 100 m square but outside a 100 m circle.
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.0008, lng: 0.0008 }, 100)).toBe(true);
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.0011, lng: 0 }, 100)).toBe(false);
    expect(roundedSquarePositionWithinBounds(center, { lat: 0.00088, lng: 0.00088 }, 100)).toBe(false);
  });
});
