import L, { type Circle, type LayerGroup, type Map as LeafletMap, type Marker, type Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
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
const tileUrl = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={accessToken}";

function escaped(value: string) {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function makeIcon(kind: "self" | "snapshot" | "point" | "item", label: string, profileImageUrl?: string | null, role?: string) {
  let html = "";
  let iconSize: [number, number] = [44, 32];
  let iconAnchor: [number, number] = [22, 16];
  if (kind === "snapshot") {
    const [name, detail] = label.split(" · ", 2);
    const portrait = profileImageUrl ? `<img src="${escaped(profileImageUrl)}" alt="" />` : `<span>${escaped(name.slice(0, 1).toUpperCase())}</span>`;
    html = `<div class="mapbox-field__ping ${role === "zombie" ? "mapbox-field__ping--zombie" : ""}"><div class="mapbox-field__portrait">${portrait}</div><div><b>${escaped(name)}</b><small>${escaped(detail ?? "LAST PING")}</small></div></div>`;
    iconSize = [158, 45]; iconAnchor = [79, 45];
  } else if (kind === "self") {
    html = `<div class="mapbox-field__self ${role === "zombie" ? "mapbox-field__self--zombie" : ""}">${profileImageUrl ? `<img src="${escaped(profileImageUrl)}" alt="Your location" />` : `<span>${escaped(label.slice(0, 1).toUpperCase())}</span>`}</div>`;
    iconSize = [38, 38]; iconAnchor = [19, 19];
  } else if (kind === "item") {
    html = `<div class="mapbox-field__item mapbox-field__item--${role}"><b>${role === "zombie" ? "☣" : "✦"}</b><span>${role === "zombie" ? "INFECTED" : "SURVIVOR"}<small>${escaped(label)}</small></span></div>`;
    iconSize = [88, 32]; iconAnchor = [44, 16];
  } else {
    html = `<div class="mapbox-field__point mapbox-field__point--${role}">${role === "extraction" ? "EXIT" : "POWER"} · ${escaped(label)}</div>`;
    iconSize = [110, 28]; iconAnchor = [55, 14];
  }
  return L.divIcon({ className: "field-map__leaflet-marker", html, iconSize, iconAnchor });
}

function placeNameFromFeature(response: any) {
  const properties = response?.features?.[0]?.properties ?? {};
  return properties.name ?? response?.features?.[0]?.text ?? "field location";
}

export default function TacticalMap({ center, radius, minimumRadius, points, players, trails, items, currentPlayerId, currentLocation, onMapClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pointLayerRef = useRef<LayerGroup | null>(null);
  const trailLayerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Map<string, MarkerRecord>>(new Map());
  const zoneRef = useRef<Circle | null>(null);
  const minimumZoneRef = useRef<Circle | null>(null);
  const clickRef = useRef(onMapClick);
  const placeCacheRef = useRef(new Map<string, string>());
  const initialBoundsRef = useRef(false);
  const centerRef = useRef<string>("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});

  const snapshotPlayers = useMemo(() => players.filter(player => player.positionKind === "snapshot" && player.lat !== null && player.lng !== null), [players]);
  const selfPlayer = players.find(player => player.id === currentPlayerId);
  const fallbackImage = useMemo(() => MAPBOX_TOKEN ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${center.lng},${center.lat},15/1280x800?access_token=${encodeURIComponent(MAPBOX_TOKEN)}` : "", [center.lat, center.lng]);
  useEffect(() => { clickRef.current = onMapClick; }, [onMapClick]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setMapError("A Mapbox public token is required to load the field map."); return; }
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, minZoom: 12, maxZoom: 19, preferCanvas: true });
    map.setView([center.lat ?? DEFAULT_CENTER.lat, center.lng ?? DEFAULT_CENTER.lng], radius > 1500 ? 13 : radius > 700 ? 14 : 15.5, { animate: false });
    L.tileLayer(tileUrl.replace("{accessToken}", encodeURIComponent(MAPBOX_TOKEN)), { tileSize: 256, maxZoom: 19, crossOrigin: "anonymous", attribution: "© <a href=\"https://www.mapbox.com/\" target=\"_blank\">Mapbox</a>" }).on("tileerror", () => {
      setMapError("Street tiles are delayed; the detailed Mapbox fallback remains available.");
    }).addTo(map);
    pointLayerRef.current = L.layerGroup().addTo(map);
    trailLayerRef.current = L.layerGroup().addTo(map);
    zoneRef.current = L.circle([center.lat, center.lng], { radius, color: "#23e0cf", weight: 3, opacity: 0.9, fillColor: "#23e0cf", fillOpacity: 0.07, interactive: false }).addTo(map);
    if (minimumRadius) minimumZoneRef.current = L.circle([center.lat, center.lng], { radius: minimumRadius, color: "#f5cb55", weight: 2, opacity: 0.92, fill: false, dashArray: "7 7", interactive: false }).addTo(map);
    map.on("click", event => clickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng }));
    mapRef.current = map;
    centerRef.current = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    window.setTimeout(() => { map.invalidateSize(false); setMapReady(true); }, 0);
    return () => { markersRef.current.clear(); map.remove(); mapRef.current = null; pointLayerRef.current = null; trailLayerRef.current = null; zoneRef.current = null; minimumZoneRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const centerKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    zoneRef.current?.setLatLng([center.lat, center.lng]).setRadius(radius);
    if (minimumRadius) {
      if (!minimumZoneRef.current) minimumZoneRef.current = L.circle([center.lat, center.lng], { radius: minimumRadius, color: "#f5cb55", weight: 2, opacity: 0.92, fill: false, dashArray: "7 7", interactive: false }).addTo(map);
      minimumZoneRef.current.setLatLng([center.lat, center.lng]).setRadius(minimumRadius);
    } else { minimumZoneRef.current?.remove(); minimumZoneRef.current = null; }
    if (!initialBoundsRef.current) {
      map.fitBounds(zoneRef.current?.getBounds() ?? L.latLngBounds([center.lat, center.lng], [center.lat, center.lng]), { padding: [42, 42], animate: false, maxZoom: 16 });
      initialBoundsRef.current = true;
    } else if (centerRef.current !== centerKey) {
      map.panTo([center.lat, center.lng], { animate: false });
    }
    centerRef.current = centerKey;
  }, [center, radius, minimumRadius, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = pointLayerRef.current;
    if (!map || !markerLayer) return;
    const next = new Map<string, { position: { lat: number; lng: number }; signature: string; icon: L.DivIcon }>();
    points.forEach(point => {
      next.set(`point:${point.id}`, { position: point, signature: `point:${point.type}:${point.label}:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`, icon: makeIcon("point", point.label, null, point.type) });
    });
    items.forEach(item => {
      next.set(`item:${item.id}`, { position: item, signature: `item:${item.faction}:${item.type}:${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`, icon: makeIcon("item", item.type.replaceAll("_", " "), null, item.faction) });
    });
    snapshotPlayers.forEach(player => {
      const location = labels[player.id] ?? "field location";
      next.set(`ping:${player.id}`, { position: { lat: player.lat!, lng: player.lng! }, signature: `ping:${player.profileImageUrl ?? ""}:${player.name}:${location}:${player.lat!.toFixed(6)}:${player.lng!.toFixed(6)}:${player.role}`, icon: makeIcon("snapshot", `${player.name} · LAST PING near ${location}`, player.profileImageUrl, player.role) });
    });
    if (selfPlayer?.lat !== null && selfPlayer?.lat !== undefined && selfPlayer.lng !== null && selfPlayer.lng !== undefined) {
      next.set("self", { position: { lat: selfPlayer.lat, lng: selfPlayer.lng }, signature: `self:${selfPlayer.profileImageUrl ?? ""}:${selfPlayer.name}:${selfPlayer.lat.toFixed(6)}:${selfPlayer.lng.toFixed(6)}:${selfPlayer.role}`, icon: makeIcon("self", selfPlayer.name, selfPlayer.profileImageUrl, selfPlayer.role) });
    } else if (currentLocation) {
      next.set("self", { position: currentLocation, signature: `self:local:${currentLocation.lat.toFixed(6)}:${currentLocation.lng.toFixed(6)}`, icon: makeIcon("self", "YOU", null, "survivor") });
    }
    markersRef.current.forEach((record, key) => { if (!next.has(key)) { markerLayer.removeLayer(record.marker); markersRef.current.delete(key); } });
    next.forEach((definition, key) => {
      const existing = markersRef.current.get(key);
      if (!existing) {
        const marker = L.marker([definition.position.lat, definition.position.lng], { icon: definition.icon, interactive: false, keyboard: false }).addTo(markerLayer);
        markersRef.current.set(key, { marker, signature: definition.signature });
      } else {
        existing.marker.setLatLng([definition.position.lat, definition.position.lng]);
        if (existing.signature !== definition.signature) existing.marker.setIcon(definition.icon);
        existing.signature = definition.signature;
      }
    });
  }, [points, items, snapshotPlayers, selfPlayer, currentLocation, labels, mapReady]);

  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();
    trails.forEach(trail => L.polyline([[trail.fromLat, trail.fromLng], [trail.toLat, trail.toLng]], { color: "#ff455c", weight: 7, opacity: 0.72, interactive: false }).addTo(trailLayer));
  }, [trails, mapReady]);

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

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([currentLocation?.lat ?? center.lat, currentLocation?.lng ?? center.lng], currentLocation ? 17 : (radius > 1500 ? 13 : 15.5), { animate: true });
  }, [center, currentLocation, radius]);
  const zoom = (delta: number) => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 15) + delta, { animate: true });

  return <div className={`field-map mapbox-field relative min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${className ?? ""}`}>
    {fallbackImage && <img src={fallbackImage} className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover" alt="Mapbox street map fallback" onError={() => setMapError("Mapbox street imagery could not be reached. Check the network and token domain settings.")} />}
    <div ref={containerRef} className="absolute inset-0 z-[1]" aria-label="Interactive two-dimensional field map" />
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3"><div className="rounded-xl border border-teal-300/30 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-teal-100 shadow-lg"><span className="block text-[9px] text-slate-400">FIELD MAP</span>2D STREET DETAIL</div>{mapError && <div className="max-w-xs rounded-xl border border-amber-300/50 bg-[#071116]/95 px-3 py-2 text-xs font-bold text-amber-100">{mapError}</div>}</div>
    {minimumRadius && onMapClick && <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-xl border border-[#f5cb55]/40 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.1em] text-[#f9e29a]">DASHED RING · MINIMUM ZONE {Math.round(minimumRadius)} M</div>}
    <div className="absolute bottom-4 right-4 z-20 grid gap-2"><button onClick={() => zoom(1)} className="field-map__control" aria-label="Zoom in"><ZoomIn size={19} /></button><button onClick={() => zoom(-1)} className="field-map__control" aria-label="Zoom out"><ZoomOut size={19} /></button><button onClick={recenter} className="field-map__control" aria-label="Recenter map"><Crosshair size={19} /></button></div>
    {!mapReady && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[#071116]/45 text-center"><MapPinned className="mx-auto mb-3 animate-pulse text-teal-200" /><div className="text-xs font-black tracking-[0.16em] text-teal-100">LOADING FIELD MAP</div></div>}
  </div>;
}
