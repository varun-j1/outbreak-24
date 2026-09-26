import mapboxgl, { type Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, MapPinned } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TacticalPoint = { id: string; lat: number; lng: number; label: string; type: "extraction" | "powerup_candidate"; isActive?: boolean };
export type TacticalPlayer = { id: string; name: string; role: "survivor" | "zombie" | "spectator"; status: string; lat: number | null; lng: number | null; positionKind: "live" | "snapshot" | "hidden"; isHost: boolean; boundaryExposed: boolean };
export type TacticalTrail = { id: string; fromLat: number; fromLng: number; toLat: number; toLng: number };
export type TacticalItem = { id: string; type: string; faction: string; lat: number; lng: number };

type Props = {
  center: { lat: number; lng: number };
  radius: number;
  points: TacticalPoint[];
  players: TacticalPlayer[];
  trails: TacticalTrail[];
  items: TacticalItem[];
  currentPlayerId: string;
  currentLocation?: { lat: number; lng: number } | null;
  onMapClick?: (position: { lat: number; lng: number }) => void;
  className?: string;
};

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const source = (features: GeoJSON.Feature[]) => ({ type: "FeatureCollection", features }) as GeoJSON.FeatureCollection;

function zonePolygon(center: { lat: number; lng: number }, radius: number) {
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    const lat = center.lat + (radius / 111_320) * Math.sin(angle);
    const lng = center.lng + (radius / (111_320 * Math.cos((center.lat * Math.PI) / 180))) * Math.cos(angle);
    return [lng, lat];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coordinates] } };
}

function localBounds(center: { lat: number; lng: number }, radius: number): [[number, number], [number, number]] {
  const latOffset = (radius * 1.2) / 111_320;
  const lngOffset = (radius * 1.2) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return [[center.lng - lngOffset, center.lat - latOffset], [center.lng + lngOffset, center.lat + latOffset]];
}

function staticMapZoom(radius: number) {
  return Math.max(13, Math.min(16, 15.4 - Math.log2(Math.max(radius, 100) / 500)));
}

export default function TacticalMap({ center, radius, points, players, trails, items, currentPlayerId, currentLocation, onMapClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapClickRef = useRef(onMapClick);
  const lastCenterRef = useRef(center);
  const [mapReady, setMapReady] = useState(false);
  const [baseMapLoaded, setBaseMapLoaded] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => { mapClickRef.current = onMapClick; }, [onMapClick]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      center: [center.lng, center.lat],
      zoom: 15.5,
      pitch: 56,
      bearing: -18,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "top-right");
    map.on("style.load", () => {
      map.setConfigProperty("basemap", "lightPreset", "night");
      map.setConfigProperty("basemap", "show3dObjects", true);
      map.setConfigProperty("basemap", "showPlaceLabels", true);
      map.setProjection("globe");
      if (!map.getSource("terrain-dem")) {
        map.addSource("terrain-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.25 });
      }
      map.fitBounds(localBounds(center, radius), { padding: 42, duration: 0, maxZoom: 16 });
      map.addSource("safe-zone", { type: "geojson", data: source([zonePolygon(center, radius)]) });
      map.addLayer({ id: "safe-zone-fill", type: "fill", source: "safe-zone", paint: { "fill-color": "#19d3c5", "fill-opacity": 0.08 } });
      map.addLayer({ id: "safe-zone-line", type: "line", source: "safe-zone", paint: { "line-color": "#19d3c5", "line-width": 2.5, "line-dasharray": [2, 1] } });
      map.addSource("trails", { type: "geojson", data: source([]) });
      map.addLayer({ id: "trails-line", type: "line", source: "trails", paint: { "line-color": "#ff455c", "line-width": 9, "line-opacity": 0.48, "line-blur": 3 } });
      map.addSource("points", { type: "geojson", data: source([]) });
      map.addLayer({ id: "points-circle", type: "circle", source: "points", paint: { "circle-radius": ["match", ["get", "kind"], "extraction", 11, "power", 7, 8], "circle-color": ["match", ["get", "kind"], "extraction", "#f5cb55", "power", "#a885ff", "#b6c8d3"], "circle-stroke-color": "#061014", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "points-label", type: "symbol", source: "points", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.6] }, paint: { "text-color": "#e8f3f6", "text-halo-color": "#061014", "text-halo-width": 1.5 } });
      map.addSource("players", { type: "geojson", data: source([]) });
      map.addLayer({ id: "players-circle", type: "circle", source: "players", paint: { "circle-radius": ["case", ["==", ["get", "self"], true], 10, ["==", ["get", "snapshot"], true], 6, 8], "circle-color": ["match", ["get", "role"], "zombie", "#ff455c", "survivor", "#1dd5c8", "#9aaeb8"], "circle-opacity": ["case", ["==", ["get", "snapshot"], true], 0.58, 1], "circle-stroke-color": "#071116", "circle-stroke-width": 2 } });
      map.addLayer({ id: "players-label", type: "symbol", source: "players", layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.45] }, paint: { "text-color": "#f7fafb", "text-halo-color": "#071116", "text-halo-width": 1.5 } });
      map.on("click", event => mapClickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
      setMapReady(true);
    });
    const markBaseMapLoaded = () => {
      window.setTimeout(() => {
        const mapTileSeen = performance.getEntriesByType("resource").some(entry => {
          const url = entry.name;
          return url.includes("mapbox.com") && !url.includes("/fonts/") && !url.includes("iconset") && (url.includes(".vector.pbf") || url.includes(".raster.pbf"));
        });
        // Never replace the street-image fallback with a WebGL canvas until a real base-map tile has arrived.
        if (mapTileSeen && map.areTilesLoaded()) setBaseMapLoaded(true);
      }, 1_000);
    };
    map.on("sourcedata", markBaseMapLoaded);
    map.on("idle", markBaseMapLoaded);
    map.on("error", event => {
      const message = event.error?.message?.toLowerCase() ?? "";
      if (message.includes("access token")) setMapError("Mapbox rejected this public token. Check its allowed URLs and Maps API access.");
      else if (message) setMapError("Live map is unavailable right now. Showing a reliable street-map fallback instead.");
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const centreChanged = Math.abs(lastCenterRef.current.lat - center.lat) > 0.00001 || Math.abs(lastCenterRef.current.lng - center.lng) > 0.00001;
    if (centreChanged) {
      map.flyTo({ center: [center.lng, center.lat], zoom: 15.5, essential: true });
      lastCenterRef.current = center;
    }
    (map.getSource("safe-zone") as mapboxgl.GeoJSONSource)?.setData(source([zonePolygon(center, radius)]));
    (map.getSource("trails") as mapboxgl.GeoJSONSource)?.setData(source(trails.map(trail => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [[trail.fromLng, trail.fromLat], [trail.toLng, trail.toLat]] } }))));
    (map.getSource("points") as mapboxgl.GeoJSONSource)?.setData(source([
      ...points.map(point => ({ type: "Feature" as const, properties: { kind: point.type === "extraction" ? "extraction" : "power", label: point.label }, geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] } })),
      ...items.map(item => ({ type: "Feature" as const, properties: { kind: "power", label: item.type.replace("_", " ").toUpperCase() }, geometry: { type: "Point" as const, coordinates: [item.lng, item.lat] } })),
    ]));
    (map.getSource("players") as mapboxgl.GeoJSONSource)?.setData(source(players.filter(player => player.lat !== null && player.lng !== null).map(player => ({ type: "Feature" as const, properties: { name: player.id === currentPlayerId ? "YOU" : player.name, role: player.role, self: player.id === currentPlayerId, snapshot: player.positionKind === "snapshot" }, geometry: { type: "Point" as const, coordinates: [player.lng!, player.lat!] } }))));
  }, [mapReady, center, radius, points, trails, items, players, currentPlayerId]);

  const recenter = () => {
    const position = currentLocation ?? center;
    mapRef.current?.flyTo({ center: [position.lng, position.lat], zoom: currentLocation ? 16 : 15.5, essential: true });
  };
  const fallbackMapUrl = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${center.lng},${center.lat},${staticMapZoom(radius)}/1280x800?access_token=${MAPBOX_TOKEN}`
    : "";
  const placeFromFallback = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!onMapClick) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    const localScale = (radius * 2.4) / Math.max(bounds.width, bounds.height);
    onMapClick({
      lat: center.lat - (y * bounds.height * localScale) / 111_320,
      lng: center.lng + (x * bounds.width * localScale) / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
    });
  };

  if (!MAPBOX_TOKEN) {
    return <div onClick={event => {
      if (!onMapClick) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      const localScale = (radius * 2.1) / Math.max(bounds.width, bounds.height);
      onMapClick({
        lat: center.lat - (y * bounds.height * localScale) / 111_320,
        lng: center.lng + (x * bounds.width * localScale) / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
      });
    }} className={`relative min-h-[440px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${onMapClick ? "cursor-crosshair" : ""} ${className ?? ""}`}>
      <div className="tactical-grid absolute inset-0 opacity-80" />
      <div className="absolute inset-x-5 top-5 rounded-xl border border-amber-300/30 bg-[#121c1f]/95 p-4 text-sm text-slate-200 shadow-xl">
        <div className="mb-1 flex items-center gap-2 font-bold text-amber-200"><MapPinned size={17} /> MAP LAYER STANDBY</div>
        Add <code>VITE_MAPBOX_TOKEN</code> to render live streets. {onMapClick ? "Tap the grid to place setup points." : "The tactical overlay and GPS gameplay are ready to test now."}
      </div>
      <FallbackMarkers center={center} radius={radius} points={points} players={players} trails={trails} items={items} currentPlayerId={currentPlayerId} />
      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between text-xs text-slate-300"><div className="rounded-lg bg-black/30 px-3 py-2">RADIUS <strong className="text-teal-200">{Math.round(radius)} m</strong></div><div className="rounded-lg bg-black/30 px-3 py-2">{players.filter(player => player.lat !== null).length} markers</div></div>
    </div>;
  }

  return <div className={`relative min-h-[440px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${className ?? ""}`}>
    <div ref={containerRef} className={`absolute inset-0 transition-opacity duration-300 ${baseMapLoaded ? "opacity-100" : "opacity-0"}`} />
    {!baseMapLoaded && <button type="button" onClick={placeFromFallback} className={`absolute inset-0 z-10 block h-full w-full overflow-hidden text-left ${onMapClick ? "cursor-crosshair" : "cursor-default"}`} aria-label={onMapClick ? "Place a game point on the street map" : "Street map loading"}>
      <img src={fallbackMapUrl} alt="Adelaide street map" className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[#071116]/10" />
      <div className="absolute left-1/2 top-1/2 grid h-[72%] aspect-square -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-dashed border-teal-300/90 bg-teal-300/5 text-[10px] font-black text-teal-100 shadow-[0_0_30px_rgba(25,211,197,.22)]"><span className="rounded-md bg-[#071116]/80 px-2 py-1">SAFE ZONE</span></div>
      <FallbackMarkers center={center} radius={radius} points={points} players={players} trails={trails} items={items} currentPlayerId={currentPlayerId} />
      <div className="absolute left-4 top-4 rounded-lg border border-teal-300/30 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-teal-100">STREET MAP READY <span className="ml-1 text-slate-400">· loading live layer</span></div>
    </button>}
    {mapError && <div className="absolute inset-x-4 top-4 z-30 rounded-xl border border-amber-300/40 bg-[#121c1f]/95 p-3 text-xs font-bold text-amber-100 shadow-xl">{mapError}</div>}
    <button onClick={recenter} className="absolute bottom-4 right-4 z-30 grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-[#111e23]/95 text-teal-200 shadow-lg transition active:scale-95" aria-label="Recenter map"><Crosshair size={20} /></button>
  </div>;
}

function fallbackPosition(center: { lat: number; lng: number }, radius: number, point: { lat: number; lng: number }) {
    const latOffset = (point.lat - center.lat) * 111_320;
    const lngOffset = (point.lng - center.lng) * 111_320 * Math.cos((center.lat * Math.PI) / 180);
    return { left: Math.min(94, Math.max(6, 50 + (lngOffset / (radius * 2.4)) * 100)), top: Math.min(94, Math.max(6, 50 - (latOffset / (radius * 2.4)) * 100)) };
}

function FallbackMarkers({ center, radius, points, players, trails, items, currentPlayerId }: Pick<Props, "center" | "radius" | "points" | "players" | "trails" | "items" | "currentPlayerId">) {
  const placedPlayers = players.filter(player => player.lat !== null && player.lng !== null);
  return <><div className="pointer-events-none absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-dashed border-teal-300/70 text-xs font-bold text-teal-100"><Crosshair size={22} /><span>ZONE</span></div>
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">{trails.map(trail => { const from = fallbackPosition(center, radius, { lat: trail.fromLat, lng: trail.fromLng }); const to = fallbackPosition(center, radius, { lat: trail.toLat, lng: trail.toLng }); return <line key={trail.id} x1={from.left} y1={from.top} x2={to.left} y2={to.top} stroke="#ff455c" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />; })}</svg>
    {points.map(point => { const position = fallbackPosition(center, radius, point); return <div key={point.id || `${point.lat}-${point.lng}`} className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#071116] px-2 py-1 text-[9px] font-black shadow-lg ${point.type === "extraction" ? "bg-[#f5cb55] text-[#071116]" : "bg-[#a885ff] text-[#071116]"}`} style={{ left: `${position.left}%`, top: `${position.top}%` }}>{point.label}</div>; })}
    {items.map(item => { const position = fallbackPosition(center, radius, item); return <div key={item.id} className="pointer-events-none absolute z-20 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#071116] bg-[#a885ff] text-[10px] font-black text-[#071116] shadow-lg" style={{ left: `${position.left}%`, top: `${position.top}%` }}>+</div>; })}
    {placedPlayers.map(player => { const position = fallbackPosition(center, radius, { lat: player.lat!, lng: player.lng! }); const self = player.id === currentPlayerId; return <div key={player.id} className={`pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border-2 border-[#071116] px-1.5 py-1 text-[9px] font-black shadow-lg ${player.role === "zombie" ? "bg-[#ff455c] text-[#071116]" : "bg-teal-300 text-[#071116]"} ${player.positionKind === "snapshot" ? "opacity-60" : ""}`} style={{ left: `${position.left}%`, top: `${position.top}%` }}><span className="grid h-4 w-4 place-items-center rounded-full bg-[#071116]/20">{player.role === "zombie" ? "Z" : "S"}</span><span>{self ? "YOU" : player.name}</span></div>; })}
  </>;
}
