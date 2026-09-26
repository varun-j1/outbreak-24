import mapboxgl, { type GeoJSONSource, type Map as MapboxMap, type Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, MapPinned, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TacticalPoint = { id: string; lat: number; lng: number; label: string; type: "extraction" | "powerup_candidate"; isActive?: boolean };
export type TacticalPlayer = { id: string; name: string; profileImageUrl?: string | null; role: "survivor" | "zombie" | "spectator"; status: string; lat: number | null; lng: number | null; positionKind: "live" | "snapshot" | "hidden"; isHost: boolean; boundaryExposed: boolean };
export type TacticalTrail = { id: string; fromLat: number; fromLng: number; toLat: number; toLng: number };
export type TacticalItem = { id: string; type: string; faction: string; lat: number; lng: number };

type Props = {
  center: { lat: number; lng: number };
  radius: number;
  minimumRadius?: number;
  points: TacticalPoint[];
  players: TacticalPlayer[];
  trails: TacticalTrail[];
  items: TacticalItem[];
  currentPlayerId: string;
  currentLocation?: { lat: number; lng: number } | null;
  onMapClick?: (position: { lat: number; lng: number }) => void;
  className?: string;
};

type MarkerRecord = { marker: Marker; signature: string };

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const DEFAULT_CENTER = { lat: -34.92051, lng: 138.60456 };
const markerColor = { survivor: "#22d6c6", zombie: "#ff455c", extraction: "#f5cb55", powerup_candidate: "#a885ff" };

function circleFeature(center: { lat: number; lng: number }, radiusMeters: number, steps = 72) {
  const coordinates = Array.from({ length: steps + 1 }, (_, index) => {
    const bearing = (index / steps) * Math.PI * 2;
    const latitude = center.lat + (radiusMeters / 111_320) * Math.cos(bearing);
    const longitude = center.lng + (radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(bearing);
    return [longitude, latitude];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coordinates] } };
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] as GeoJSON.Feature[] };
}

function pointCollection(points: TacticalPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map(point => ({ type: "Feature" as const, properties: { id: point.id, label: point.label, type: point.type }, geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] } })),
  };
}

function trailCollection(trails: TacticalTrail[]) {
  return {
    type: "FeatureCollection" as const,
    features: trails.map(trail => ({ type: "Feature" as const, properties: { id: trail.id }, geometry: { type: "LineString" as const, coordinates: [[trail.fromLng, trail.fromLat], [trail.toLng, trail.toLat]] } })),
  };
}

function makePinElement(kind: "self" | "snapshot" | "point" | "item", label: string, profileImageUrl?: string | null, role?: string) {
  const element = document.createElement("div");
  if (kind === "snapshot") {
    element.className = `mapbox-field__ping ${role === "zombie" ? "mapbox-field__ping--zombie" : ""}`;
    const portrait = profileImageUrl ? `<img src="${profileImageUrl}" alt="" />` : `<span>${label.slice(0, 1).toUpperCase()}</span>`;
    element.innerHTML = `<div class="mapbox-field__portrait">${portrait}</div><div><b>${label.split(" · ")[0]}</b><small>${label.split(" · ").slice(1).join(" · ")}</small></div>`;
  } else if (kind === "self") {
    element.className = `mapbox-field__self ${role === "zombie" ? "mapbox-field__self--zombie" : ""}`;
    element.innerHTML = profileImageUrl ? `<img src="${profileImageUrl}" alt="Your location" />` : `<span>${label.slice(0, 1).toUpperCase()}</span>`;
  } else if (kind === "item") {
    element.className = `mapbox-field__item mapbox-field__item--${role}`;
    element.innerHTML = `<b>${role === "zombie" ? "☣" : "✦"}</b><span>${role === "zombie" ? "INFECTED" : "SURVIVOR"}<small>${label}</small></span>`;
  } else {
    element.className = `mapbox-field__point mapbox-field__point--${role}`;
    element.textContent = `${role === "extraction" ? "EXIT" : "POWER"} · ${label}`;
  }
  return element;
}

function placeNameFromFeature(response: any) {
  const properties = response?.features?.[0]?.properties ?? {};
  return properties.name ?? response?.features?.[0]?.text ?? "field location";
}

export default function TacticalMap({ center, radius, minimumRadius, points, players, trails, items, currentPlayerId, currentLocation, onMapClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, MarkerRecord>>(new Map());
  const clickRef = useRef(onMapClick);
  const placeCacheRef = useRef(new Map<string, string>());
  const didFrameRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});

  const snapshotPlayers = useMemo(() => players.filter(player => player.positionKind === "snapshot" && player.lat !== null && player.lng !== null), [players]);
  const selfPlayer = players.find(player => player.id === currentPlayerId);
  useEffect(() => { clickRef.current = onMapClick; }, [onMapClick]);

  const setSourceData = useCallback((sourceId: string, data: any) => {
    const source = mapRef.current?.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  }, []);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = new Map<string, { position: { lat: number; lng: number }; signature: string; element: HTMLElement }>();
    points.forEach(point => {
      const signature = `point:${point.type}:${point.label}:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`;
      next.set(`point:${point.id}`, { position: point, signature, element: makePinElement("point", point.label, null, point.type) });
    });
    items.forEach(item => {
      const signature = `item:${item.faction}:${item.type}:${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;
      next.set(`item:${item.id}`, { position: item, signature, element: makePinElement("item", item.type.replaceAll("_", " "), null, item.faction) });
    });
    snapshotPlayers.forEach(player => {
      const location = labels[player.id] ?? "field location";
      const signature = `ping:${player.profileImageUrl ?? ""}:${player.name}:${location}:${player.lat!.toFixed(6)}:${player.lng!.toFixed(6)}:${player.role}`;
      next.set(`ping:${player.id}`, { position: { lat: player.lat!, lng: player.lng! }, signature, element: makePinElement("snapshot", `${player.name} · LAST PING near ${location}`, player.profileImageUrl, player.role) });
    });
    if (selfPlayer?.lat !== null && selfPlayer?.lat !== undefined && selfPlayer.lng !== null && selfPlayer.lng !== undefined) {
      const signature = `self:${selfPlayer.profileImageUrl ?? ""}:${selfPlayer.name}:${selfPlayer.lat.toFixed(6)}:${selfPlayer.lng.toFixed(6)}:${selfPlayer.role}`;
      next.set("self", { position: { lat: selfPlayer.lat, lng: selfPlayer.lng }, signature, element: makePinElement("self", selfPlayer.name, selfPlayer.profileImageUrl, selfPlayer.role) });
    } else if (currentLocation) {
      const signature = `self:local:${currentLocation.lat.toFixed(6)}:${currentLocation.lng.toFixed(6)}`;
      next.set("self", { position: currentLocation, signature, element: makePinElement("self", "YOU", null, "survivor") });
    }
    markersRef.current.forEach((record, key) => { if (!next.has(key)) { record.marker.remove(); markersRef.current.delete(key); } });
    next.forEach((definition, key) => {
      const existing = markersRef.current.get(key);
      if (!existing || existing.signature !== definition.signature) {
        existing?.marker.remove();
        const marker = new mapboxgl.Marker({ element: definition.element, anchor: key.startsWith("ping") ? "bottom" : "center" }).setLngLat([definition.position.lng, definition.position.lat]).addTo(map);
        markersRef.current.set(key, { marker, signature: definition.signature });
      } else {
        existing.marker.setLngLat([definition.position.lng, definition.position.lat]);
      }
    });
  }, [points, items, snapshotPlayers, selfPlayer, currentLocation, labels]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setMapError("A Mapbox public token is required to load the field map."); return; }
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [center.lng ?? DEFAULT_CENTER.lng, center.lat ?? DEFAULT_CENTER.lat],
      zoom: radius > 1500 ? 13 : radius > 700 ? 14 : 15.5,
      pitch: 0,
      bearing: 0,
      attributionControl: true,
      dragRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource("zone", { type: "geojson", data: circleFeature(center, radius) });
      map.addSource("minimum-zone", { type: "geojson", data: minimumRadius ? circleFeature(center, minimumRadius) : emptyCollection() });
      map.addSource("trails", { type: "geojson", data: trailCollection([]) });
      map.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": "#23e0cf", "fill-opacity": 0.07 } });
      map.addLayer({ id: "zone-outline", type: "line", source: "zone", paint: { "line-color": "#23e0cf", "line-width": 3, "line-opacity": 0.9 } });
      map.addLayer({ id: "minimum-zone-outline", type: "line", source: "minimum-zone", paint: { "line-color": "#f5cb55", "line-width": 2, "line-opacity": 0.92, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "trails-line", type: "line", source: "trails", paint: { "line-color": "#ff455c", "line-width": 7, "line-opacity": 0.72 } });
      map.on("click", event => clickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
      mapRef.current = map;
      setMapReady(true);
      const longitudePadding = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
      const latitudePadding = radius / 111_320;
      map.fitBounds([[center.lng - longitudePadding, center.lat - latitudePadding], [center.lng + longitudePadding, center.lat + latitudePadding]], { padding: 48, duration: 0, maxZoom: 16 });
      didFrameRef.current = true;
    });
    map.on("error", event => { if (event.error) setMapError("Mapbox could not load map details. Check the token and permitted domain."); });
    return () => { markersRef.current.forEach(record => record.marker.remove()); markersRef.current.clear(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    setSourceData("zone", circleFeature(center, radius));
    setSourceData("minimum-zone", minimumRadius ? circleFeature(center, minimumRadius) : emptyCollection());
    setSourceData("trails", trailCollection(trails));
  }, [mapReady, center, radius, minimumRadius, trails, setSourceData]);

  useEffect(() => { if (mapReady) syncMarkers(); }, [mapReady, syncMarkers]);

  useEffect(() => {
    if (!snapshotPlayers.length || !MAPBOX_TOKEN) return;
    let cancelled = false;
    void Promise.all(snapshotPlayers.map(async player => {
      const key = `${player.lat!.toFixed(4)},${player.lng!.toFixed(4)}`;
      if (placeCacheRef.current.has(key)) return [player.id, placeCacheRef.current.get(key)!] as const;
      try {
        const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${player.lng}&latitude=${player.lat}&types=street,neighborhood,place&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`);
        const result = await response.json();
        const label = placeNameFromFeature(result);
        placeCacheRef.current.set(key, label);
        return [player.id, label] as const;
      } catch { return [player.id, "field location"] as const; }
    })).then(entries => { if (!cancelled) setLabels(current => ({ ...current, ...Object.fromEntries(entries) })); });
    return () => { cancelled = true; };
  }, [snapshotPlayers]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [currentLocation?.lng ?? center.lng, currentLocation?.lat ?? center.lat], zoom: currentLocation ? 17 : (radius > 1500 ? 13 : 15.5), duration: 450 });
  };
  const zoom = (delta: number) => mapRef.current?.easeTo({ zoom: (mapRef.current.getZoom() ?? 15) + delta, duration: 180 });

  return <div className={`field-map mapbox-field relative min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${className ?? ""}`}>
    <div ref={containerRef} className="absolute inset-0" aria-label="Interactive two-dimensional field map" />
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3"><div className="rounded-xl border border-teal-300/30 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-teal-100 shadow-lg"><span className="block text-[9px] text-slate-400">FIELD MAP</span>2D STREET DETAIL</div>{mapError && <div className="max-w-xs rounded-xl border border-[#ff455c]/50 bg-[#071116]/95 px-3 py-2 text-xs font-bold text-[#ffb2bd]">{mapError}</div>}</div>
    {minimumRadius && onMapClick && <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-xl border border-[#f5cb55]/40 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.1em] text-[#f9e29a]">DASHED RING · MINIMUM ZONE {Math.round(minimumRadius)} M</div>}
    <div className="absolute bottom-4 right-4 z-10 grid gap-2"><button onClick={() => zoom(1)} className="field-map__control" aria-label="Zoom in"><ZoomIn size={19} /></button><button onClick={() => zoom(-1)} className="field-map__control" aria-label="Zoom out"><ZoomOut size={19} /></button><button onClick={recenter} className="field-map__control" aria-label="Recenter map"><Crosshair size={19} /></button></div>
    {!mapReady && <div className="absolute inset-0 z-20 grid place-items-center bg-[#071116]/85 text-center"><MapPinned className="mx-auto mb-3 animate-pulse text-teal-200" /><div className="text-xs font-black tracking-[0.16em] text-teal-100">LOADING FIELD MAP</div></div>}
  </div>;
}
