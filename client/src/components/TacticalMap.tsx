import L, {
  type LayerGroup,
  type Map as LeafletMap,
  type Marker,
  type Polygon,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Crosshair,
  Footprints,
  MapPinned,
  Route as RouteIcon,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fieldHaptic as haptic, playFieldCue } from "@/lib/field-feedback";
export type TacticalPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  type: "extraction" | "powerup_candidate";
  isActive?: boolean;
};
export type TacticalPlayer = {
  id: string;
  name: string;
  profileImageUrl?: string | null;
  role: "survivor" | "zombie" | "spectator";
  status: string;
  lat: number | null;
  lng: number | null;
  positionKind: "live" | "snapshot" | "hidden";
  pingedAt?: string | Date | null;
  isHost: boolean;
  boundaryExposed: boolean;
};
export type TacticalTrail = {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
};
export type TacticalItem = {
  id: string;
  type: string;
  faction: string;
  lat: number;
  lng: number;
};
type Coordinate = {
  lat: number;
  lng: number;
};
type Props = {
  center: Coordinate;
  radius: number;
  minimumRadius?: number;
  points: TacticalPoint[];
  players: TacticalPlayer[];
  trails: TacticalTrail[];
  items: TacticalItem[];
  currentPlayerId: string;
  currentLocation?: Coordinate | null;
  onMapClick?: (position: Coordinate) => void;
  setupFocus?: boolean;
  className?: string;
};
type MarkerRecord = {
  marker: Marker;
  signature: string;
};
type RouteState = {
  targetId: string;
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  sourcePingAt: number;
  loading?: boolean;
  error?: string;
};
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const DEFAULT_CENTER = { lat: -34.92051, lng: 138.60456 };
const tileUrl =
  "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={accessToken}";
function escaped(value: string) {
  return value.replace(
    /[&<>'"]/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ] ?? char
  );
}
function makeIcon(
  kind: "self" | "snapshot" | "point" | "item",
  label: string,
  profileImageUrl?: string | null,
  role?: string,
  compact = false,
  movementHeading?: number | null
) {
  let html = "";
  let iconSize: [number, number] = [44, 32];
  let iconAnchor: [number, number] = [22, 16];
  if (kind === "snapshot") {
    const [name, detail] = label.split(" · ", 2);
    const portrait = profileImageUrl
      ? `<img src="${escaped(profileImageUrl)}" alt="" />`
      : `<span>${escaped(name.slice(0, 1).toUpperCase())}</span>`;
    html = compact
      ? `<div class="mapbox-field__ping mapbox-field__ping--compact ${role === "zombie" ? "mapbox-field__ping--zombie" : ""}" title="${escaped(name)} · ${escaped(detail ?? "LAST PING")}"><div class="mapbox-field__portrait">${portrait}</div></div>`
      : `<div class="mapbox-field__ping ${role === "zombie" ? "mapbox-field__ping--zombie" : ""}"><div class="mapbox-field__portrait">${portrait}</div><div><b>${escaped(name)}</b><small>${escaped(detail ?? "LAST PING")}</small></div></div>`;
    iconSize = compact ? [34, 34] : [158, 45];
    iconAnchor = compact ? [17, 17] : [79, 45];
  } else if (kind === "self") {
    html = `<div class="mapbox-field__self-wrap">${movementHeading === null || movementHeading === undefined ? "" : `<span class="mapbox-field__heading" style="transform:rotate(${movementHeading}deg)" aria-hidden="true">▲</span>`}<div class="mapbox-field__self ${role === "zombie" ? "mapbox-field__self--zombie" : ""}">${profileImageUrl ? `<img src="${escaped(profileImageUrl)}" alt="Player location" />` : `<span>${escaped(label.slice(0, 1).toUpperCase())}</span>`}</div></div>`;
    iconSize = [38, 38];
    iconAnchor = [19, 19];
  } else if (kind === "item") {
    html = `<div class="mapbox-field__item mapbox-field__item--${role}"><b>${role === "zombie" ? "☣" : "✦"}</b><span>${role === "zombie" ? "INFECTED" : "SURVIVOR"}<small>${escaped(label)}</small></span></div>`;
    iconSize = [88, 32];
    iconAnchor = [44, 16];
  } else {
    html = `<div class="mapbox-field__point mapbox-field__point--${role}">${role === "extraction" ? "EXIT" : "POWER"} · ${escaped(label)}</div>`;
    iconSize = [110, 28];
    iconAnchor = [55, 14];
  }
  return L.divIcon({
    className: "field-map__leaflet-marker",
    html,
    iconSize,
    iconAnchor,
  });
}
function placeNameFromFeature(response: any) {
  const properties = response?.features?.[0]?.properties ?? {};
  return properties.name ?? response?.features?.[0]?.text ?? "field location";
}
function bearingDegrees(from: Coordinate, to: Coordinate) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const longitude = radians(to.lng - from.lng);
  const y = Math.sin(longitude) * Math.cos(radians(to.lat));
  const x =
    Math.cos(radians(from.lat)) * Math.sin(radians(to.lat)) -
    Math.sin(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.cos(longitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function movementDistanceMeters(from: Coordinate, to: Coordinate) {
  const latitudeMeters = (to.lat - from.lat) * 111320;
  const longitudeMeters =
    (to.lng - from.lng) * 111320 * Math.cos((from.lat * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}
function offsetCoordinate(
  center: Coordinate,
  xMeters: number,
  yMeters: number
): [number, number] {
  return [
    center.lat + yMeters / 111320,
    center.lng + xMeters / (111320 * Math.cos((center.lat * Math.PI) / 180)),
  ];
}
function roundedSquareLatLngs(
  center: Coordinate,
  halfWidthMeters: number
): Array<[number, number]> {
  const half = Math.max(1, halfWidthMeters);
  const cornerRadius = Math.min(Math.max(12, half * 0.18), half * 0.42);
  const edge = half - cornerRadius;
  const points: Array<[number, number]> = [];
  const cornerCenters: Array<[number, number, number]> = [
    [edge, edge, 0],
    [-edge, edge, Math.PI / 2],
    [-edge, -edge, Math.PI],
    [edge, -edge, Math.PI * 1.5],
  ];
  cornerCenters.forEach(([x, y, start]) => {
    for (let index = 0; index <= 6; index++) {
      const angle = start + (Math.PI / 2) * (index / 6);
      points.push(
        offsetCoordinate(
          center,
          x + cornerRadius * Math.cos(angle),
          y + cornerRadius * Math.sin(angle)
        )
      );
    }
  });
  return points;
}
function formatRouteDistance(distanceMeters: number) {
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`;
}
function formatRouteDuration(seconds: number) {
  return `${Math.max(1, Math.ceil(seconds / 60))} min walk`;
}
function pingTimestamp(player?: TacticalPlayer) {
  if (!player?.pingedAt) return 0;
  const value = new Date(player.pingedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}
export default function TacticalMap({
  center,
  radius,
  minimumRadius,
  points,
  players,
  trails,
  items,
  currentPlayerId,
  currentLocation,
  onMapClick,
  setupFocus = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pointLayerRef = useRef<LayerGroup | null>(null);
  const trailLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Map<string, MarkerRecord>>(new Map());
  const zoneRef = useRef<Polygon | null>(null);
  const minimumZoneRef = useRef<Polygon | null>(null);
  const clickRef = useRef(onMapClick);
  const placeCacheRef = useRef(new Map<string, string>());
  const initialBoundsRef = useRef(false);
  const setupFocusRef = useRef(false);
  const centerRef = useRef<string>("");
  const previousPositionsRef = useRef(new Map<string, Coordinate>());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [movementHeadings, setMovementHeadings] = useState<
    Record<string, number>
  >({});
  const selfPlayer = players.find(player => player.id === currentPlayerId);
  const snapshotPlayers = useMemo(
    () =>
      players.filter(
        player =>
          player.positionKind === "snapshot" &&
          player.lat !== null &&
          player.lng !== null
      ),
    [players]
  );
  const livePlayers = useMemo(
    () =>
      players.filter(
        player =>
          player.id !== currentPlayerId &&
          player.positionKind === "live" &&
          player.lat !== null &&
          player.lng !== null
      ),
    [players, currentPlayerId]
  );
  const routeCandidates = useMemo(
    () => (selfPlayer?.role === "zombie" ? snapshotPlayers : []),
    [selfPlayer?.role, snapshotPlayers]
  );
  const ownPosition =
    currentLocation ??
    (selfPlayer?.lat !== null &&
    selfPlayer?.lat !== undefined &&
    selfPlayer.lng !== null &&
    selfPlayer.lng !== undefined
      ? { lat: selfPlayer.lat, lng: selfPlayer.lng }
      : null);
  const routeTarget =
    routeCandidates.find(player => player.id === routeTargetId) ??
    routeCandidates[0];
  const routeTargetPingAt = pingTimestamp(routeTarget);
  const routeNeedsRefresh = Boolean(
    routeState &&
      routeTarget &&
      routeState.targetId === routeTarget.id &&
      routeTargetPingAt > routeState.sourcePingAt
  );
  const fallbackImage = useMemo(
    () =>
      MAPBOX_TOKEN
        ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${center.lng},${center.lat},15/1280x800?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
        : "",
    [center.lat, center.lng]
  );
  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    const observed = [
      ...livePlayers.map(player => ({
        id: player.id,
        position: { lat: player.lat!, lng: player.lng! },
      })),
      ...(ownPosition ? [{ id: currentPlayerId, position: ownPosition }] : []),
    ];
    const updates: Record<string, number> = {};
    observed.forEach(({ id, position }) => {
      const previous = previousPositionsRef.current.get(id);
      if (previous && movementDistanceMeters(previous, position) >= 3)
        updates[id] = Math.round(bearingDegrees(previous, position));
      previousPositionsRef.current.set(id, position);
    });
    if (Object.keys(updates).length)
      setMovementHeadings(current => ({ ...current, ...updates }));
  }, [livePlayers, ownPosition, currentPlayerId]);
  useEffect(() => {
    setRouteTargetId(current =>
      routeCandidates.some(player => player.id === current)
        ? current
        : (routeCandidates[0]?.id ?? null)
    );
    setRouteState(current =>
      current && routeCandidates.some(player => player.id === current.targetId)
        ? current
        : null
    );
  }, [routeCandidates]);
  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setMapError("A Mapbox public token is required to load the field map.");
      return;
    }
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      minZoom: 12,
      maxZoom: 19,
      preferCanvas: false,
    });
    map.setView(
      [center.lat ?? DEFAULT_CENTER.lat, center.lng ?? DEFAULT_CENTER.lng],
      radius > 1500 ? 13 : radius > 700 ? 14 : 15.5,
      { animate: false }
    );
    L.tileLayer(
      tileUrl.replace("{accessToken}", encodeURIComponent(MAPBOX_TOKEN)),
      {
        tileSize: 256,
        maxZoom: 19,
        crossOrigin: "anonymous",
        attribution:
          '© <a href="https://www.mapbox.com/" target="_blank">Mapbox</a>',
      }
    )
      .on("tileerror", () => {
        setMapError(
          "Street tiles are delayed; the detailed Mapbox fallback remains available."
        );
      })
      .addTo(map);
    pointLayerRef.current = L.layerGroup().addTo(map);
    trailLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    zoneRef.current = L.polygon(roundedSquareLatLngs(center, radius), {
      color: "#23e0cf",
      weight: 3,
      opacity: 0.94,
      fillColor: "#23e0cf",
      fillOpacity: 0.07,
      interactive: false,
    }).addTo(map);
    if (minimumRadius)
      minimumZoneRef.current = L.polygon(
        roundedSquareLatLngs(center, minimumRadius),
        {
          color: "#f5cb55",
          weight: 2,
          opacity: 0.92,
          fill: false,
          dashArray: "7 7",
          interactive: false,
        }
      ).addTo(map);
    map.on("click", event =>
      clickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng })
    );
    mapRef.current = map;
    centerRef.current = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    window.setTimeout(() => {
      map.invalidateSize(false);
      setMapReady(true);
    }, 0);
    return () => {
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      pointLayerRef.current = null;
      trailLayerRef.current = null;
      routeLayerRef.current = null;
      zoneRef.current = null;
      minimumZoneRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const centerKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    zoneRef.current?.setLatLngs(roundedSquareLatLngs(center, radius));
    if (minimumRadius) {
      if (!minimumZoneRef.current)
        minimumZoneRef.current = L.polygon(
          roundedSquareLatLngs(center, minimumRadius),
          {
            color: "#f5cb55",
            weight: 2,
            opacity: 0.92,
            fill: false,
            dashArray: "7 7",
            interactive: false,
          }
        ).addTo(map);
      minimumZoneRef.current.setLatLngs(
        roundedSquareLatLngs(center, minimumRadius)
      );
    } else {
      minimumZoneRef.current?.remove();
      minimumZoneRef.current = null;
    }
    if (!initialBoundsRef.current) {
      map.fitBounds(
        zoneRef.current?.getBounds() ??
          L.latLngBounds([center.lat, center.lng], [center.lat, center.lng]),
        { padding: [42, 42], animate: false, maxZoom: 16 }
      );
      initialBoundsRef.current = true;
    } else if (centerRef.current !== centerKey) {
      map.panTo([center.lat, center.lng], { animate: false });
    }
    centerRef.current = centerKey;
  }, [center, radius, minimumRadius, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!setupFocus) {
      setupFocusRef.current = false;
      return;
    }
    if (!setupFocusRef.current) {
      const fieldBounds = zoneRef.current?.getBounds();
      if (fieldBounds?.isValid())
        map.fitBounds(fieldBounds, {
          padding: [48, 48],
          maxZoom: radius > 700 ? 14.8 : 15.5,
          animate: true,
        });
      setupFocusRef.current = true;
    }
  }, [setupFocus, mapReady, center, radius]);
  useEffect(() => {
    const markerLayer = pointLayerRef.current;
    if (!markerLayer) return;
    const next = new Map<
      string,
      {
        position: Coordinate;
        signature: string;
        icon: L.DivIcon;
      }
    >();
    points.forEach(point => {
      next.set(`point:${point.id}`, {
        position: point,
        signature: `point:${point.type}:${point.label}:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`,
        icon: makeIcon("point", point.label, null, point.type),
      });
    });
    items.forEach(item => {
      next.set(`item:${item.id}`, {
        position: item,
        signature: `item:${item.faction}:${item.type}:${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`,
        icon: makeIcon(
          "item",
          item.type.replaceAll("_", " "),
          null,
          item.faction
        ),
      });
    });
    snapshotPlayers.forEach(player => {
      const location = labels[player.id] ?? "field location";
      const compact = Date.now() - pingTimestamp(player) > 10000;
      next.set(`ping:${player.id}`, {
        position: { lat: player.lat!, lng: player.lng! },
        signature: `ping:${player.profileImageUrl ?? ""}:${player.name}:${location}:${player.lat!.toFixed(6)}:${player.lng!.toFixed(6)}:${player.role}:${compact}`,
        icon: makeIcon(
          "snapshot",
          `${player.name} · LAST PING near ${location}`,
          player.profileImageUrl,
          player.role,
          compact
        ),
      });
    });
    livePlayers.forEach(player => {
      const movementHeading = movementHeadings[player.id];
      next.set(`live:${player.id}`, {
        position: { lat: player.lat!, lng: player.lng! },
        signature: `live:${player.profileImageUrl ?? ""}:${player.name}:${player.lat!.toFixed(6)}:${player.lng!.toFixed(6)}:${player.role}:${movementHeading ?? ""}`,
        icon: makeIcon(
          "self",
          player.name,
          player.profileImageUrl,
          player.role,
          false,
          movementHeading
        ),
      });
    });
    if (ownPosition) {
      const movementHeading = movementHeadings[currentPlayerId];
      next.set("self", {
        position: ownPosition,
        signature: `self:${selfPlayer?.profileImageUrl ?? ""}:${selfPlayer?.name ?? "YOU"}:${ownPosition.lat.toFixed(6)}:${ownPosition.lng.toFixed(6)}:${selfPlayer?.role ?? "survivor"}:${movementHeading ?? ""}`,
        icon: makeIcon(
          "self",
          selfPlayer?.name ?? "YOU",
          selfPlayer?.profileImageUrl,
          selfPlayer?.role ?? "survivor",
          false,
          movementHeading
        ),
      });
    }
    markersRef.current.forEach((record, key) => {
      if (!next.has(key)) {
        markerLayer.removeLayer(record.marker);
        markersRef.current.delete(key);
      }
    });
    next.forEach((definition, key) => {
      const existing = markersRef.current.get(key);
      if (!existing) {
        const marker = L.marker(
          [definition.position.lat, definition.position.lng],
          { icon: definition.icon, interactive: false, keyboard: false }
        ).addTo(markerLayer);
        markersRef.current.set(key, {
          marker,
          signature: definition.signature,
        });
      } else {
        existing.marker.setLatLng([
          definition.position.lat,
          definition.position.lng,
        ]);
        if (existing.signature !== definition.signature)
          existing.marker.setIcon(definition.icon);
        existing.signature = definition.signature;
      }
    });
  }, [
    points,
    items,
    snapshotPlayers,
    livePlayers,
    selfPlayer,
    ownPosition,
    labels,
    mapReady,
    movementHeadings,
    currentPlayerId,
  ]);
  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();
    trails.forEach(trail =>
      L.polyline(
        [
          [trail.fromLat, trail.fromLng],
          [trail.toLat, trail.toLng],
        ],
        { color: "#ff455c", weight: 7, opacity: 0.72, interactive: false }
      ).addTo(trailLayer)
    );
  }, [trails, mapReady]);
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    if (!routeLayer) return;
    routeLayer.clearLayers();
    if (
      !routeState ||
      routeState.loading ||
      routeState.error ||
      routeState.coordinates.length < 2
    )
      return;
    L.polyline(
      routeState.coordinates.map(
        ([lng, lat]) => [lat, lng] as [number, number]
      ),
      {
        color: "#f5cb55",
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        dashArray: "12 9",
        interactive: false,
      }
    ).addTo(routeLayer);
  }, [routeState, mapReady]);
  useEffect(() => {
    if (!snapshotPlayers.length || !MAPBOX_TOKEN) return;
    let cancelled = false;
    void Promise.all(
      snapshotPlayers.map(async player => {
        const key = `${player.lat!.toFixed(4)},${player.lng!.toFixed(4)}`;
        if (placeCacheRef.current.has(key))
          return [player.id, placeCacheRef.current.get(key)!] as const;
        try {
          const response = await fetch(
            `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${player.lng}&latitude=${player.lat}&types=street,neighborhood,place&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
          );
          const result = await response.json();
          const label = placeNameFromFeature(result);
          placeCacheRef.current.set(key, label);
          return [player.id, label] as const;
        } catch {
          return [player.id, "field location"] as const;
        }
      })
    ).then(entries => {
      if (!cancelled)
        setLabels(current => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [snapshotPlayers]);
  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView(
      [ownPosition?.lat ?? center.lat, ownPosition?.lng ?? center.lng],
      ownPosition ? 17 : radius > 1500 ? 13 : 15.5,
      { animate: true }
    );
    haptic(12);
  }, [center, ownPosition, radius]);
  const zoom = (delta: number) => {
    mapRef.current?.setZoom((mapRef.current.getZoom() ?? 15) + delta, {
      animate: true,
    });
    haptic(8);
  };
  const buildRoute = async () => {
    if (!routeTarget || !ownPosition || !MAPBOX_TOKEN) {
      setRouteState({
        targetId: routeTarget?.id ?? "",
        coordinates: [],
        distanceMeters: 0,
        durationSeconds: 0,
        sourcePingAt: routeTargetPingAt,
        error: "Location is needed before a route can be built.",
      });
      return;
    }
    setRouteState({
      targetId: routeTarget.id,
      coordinates: [],
      distanceMeters: 0,
      durationSeconds: 0,
      sourcePingAt: routeTargetPingAt,
      loading: true,
    });
    haptic([18, 22, 18]);
    playFieldCue("route");
    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/walking/${ownPosition.lng},${ownPosition.lat};${routeTarget.lng},${routeTarget.lat}?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
      );
      const result = await response.json();
      const route = result?.routes?.[0];
      if (!response.ok || !route?.geometry?.coordinates?.length)
        throw new Error(
          result?.message ?? "Mapbox could not build a walking route."
        );
      const next = {
        targetId: routeTarget.id,
        coordinates: route.geometry.coordinates as Array<[number, number]>,
        distanceMeters: Number(route.distance ?? 0),
        durationSeconds: Number(route.duration ?? 0),
        sourcePingAt: routeTargetPingAt,
      };
      setRouteState(next);
      const map = mapRef.current;
      if (map)
        map.fitBounds(
          L.latLngBounds(
            next.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
          ),
          { padding: [74, 74], maxZoom: 16.5, animate: true }
        );
      haptic([25, 30, 25]);
      playFieldCue("success");
    } catch (error) {
      setRouteState({
        targetId: routeTarget.id,
        coordinates: [],
        distanceMeters: 0,
        durationSeconds: 0,
        sourcePingAt: routeTargetPingAt,
        error:
          error instanceof Error
            ? error.message
            : "Could not build a walking route.",
      });
      haptic([70, 35, 70]);
      playFieldCue("alert");
    }
  };
  const routeIsCurrent = routeState?.targetId === routeTarget?.id;
  return (
    <div
      className={`field-map mapbox-field relative min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${className ?? ""}`}
    >
      {fallbackImage && (
        <img
          src={fallbackImage}
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          alt="Mapbox street map fallback"
          onError={() =>
            setMapError(
              "Mapbox street imagery could not be reached. Check the network and token domain settings."
            )
          }
        />
      )}
      <div
        ref={containerRef}
        className="absolute inset-0 z-[1]"
        aria-label="Interactive two-dimensional field map"
      />
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3">
        <div className="rounded-xl border border-teal-300/30 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-teal-100 shadow-lg">
          <span className="block text-[9px] text-slate-400">FIELD MAP</span>2D
          STREET DETAIL
        </div>
        {mapError && (
          <div className="max-w-xs rounded-xl border border-amber-300/50 bg-[#071116]/95 px-3 py-2 text-xs font-bold text-amber-100">
            {mapError}
          </div>
        )}
      </div>
      {routeTarget && ownPosition && (
        <div className="absolute bottom-4 left-4 z-20 max-w-[min(19rem,calc(100%-5.5rem))] rounded-xl border border-[#f5cb55]/50 bg-[#071116]/95 p-2.5 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#f5cb55] text-[#071116]">
              <Footprints size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-black tracking-[.1em] text-[#f9e29a]">
                LAST PING · {routeTarget.name.toUpperCase()}
              </div>
              <div className="text-[10px] font-bold text-slate-400">
                {routeNeedsRefresh
                  ? "NEWER PING AVAILABLE"
                  : routeIsCurrent && !routeState?.loading && !routeState?.error
                    ? `${formatRouteDistance(routeState.distanceMeters)} · ${formatRouteDuration(routeState.durationSeconds)}`
                    : "Walking route from your location"}
              </div>
            </div>
          </div>
          {routeCandidates.length > 1 && (
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {routeCandidates.map(player => (
                <button
                  key={player.id}
                  onClick={() => {
                    setRouteTargetId(player.id);
                    setRouteState(null);
                    haptic(10);
                  }}
                  className={`whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-black ${player.id === routeTarget.id ? "bg-[#f5cb55] text-[#071116]" : "bg-white/10 text-slate-300"}`}
                >
                  {player.name}
                </button>
              ))}
            </div>
          )}
          {routeNeedsRefresh && (
            <div className="mt-2 rounded-lg border border-[#f5cb55]/35 bg-[#f5cb55]/10 px-2 py-1.5 text-[9px] font-black tracking-[.08em] text-[#f9e29a]">
              A NEWER LAST-LOCATION PING ARRIVED. YOUR CURRENT ROUTE IS
              UNCHANGED.
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void buildRoute()}
              disabled={routeState?.loading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f5cb55] px-3 py-2 text-[10px] font-black text-[#071116] disabled:opacity-60"
            >
              <RouteIcon size={14} />
              {routeState?.loading
                ? "ROUTING…"
                : routeNeedsRefresh
                  ? "REFRESH TO NEW PING"
                  : routeIsCurrent
                    ? "RECALCULATE ROUTE"
                    : "ROUTE TO PING"}
            </button>
            {routeIsCurrent && (
              <button
                onClick={() => {
                  setRouteState(null);
                  haptic(10);
                }}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-slate-200"
                aria-label="Clear route"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {routeIsCurrent && routeState?.error && (
            <p className="mt-2 text-[10px] font-bold text-[#ff9ba8]">
              {routeState.error}
            </p>
          )}
        </div>
      )}
      {minimumRadius && onMapClick && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-xl border border-[#f5cb55]/40 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.1em] text-[#f9e29a]">
          DASHED ROUNDED SQUARE · MINIMUM {Math.round(minimumRadius)} M
        </div>
      )}
      <div className="absolute bottom-4 right-4 z-20 grid gap-2">
        <button
          onClick={() => zoom(1)}
          className="field-map__control"
          aria-label="Zoom in"
        >
          <ZoomIn size={19} />
        </button>
        <button
          onClick={() => zoom(-1)}
          className="field-map__control"
          aria-label="Zoom out"
        >
          <ZoomOut size={19} />
        </button>
        <button
          onClick={recenter}
          className="field-map__control"
          aria-label="Recenter map"
        >
          <Crosshair size={19} />
        </button>
      </div>
      {!mapReady && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[#071116]/45 text-center">
          <MapPinned className="mx-auto mb-3 animate-pulse text-teal-200" />
          <div className="text-xs font-black tracking-[0.16em] text-teal-100">
            LOADING FIELD MAP
          </div>
        </div>
      )}
    </div>
  );
}
