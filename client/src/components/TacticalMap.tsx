import { Crosshair, MapPinned, Rotate3D, Satellite, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapView } from "@/components/Map";

export type TacticalPoint = { id: string; lat: number; lng: number; label: string; type: "extraction" | "powerup_candidate"; isActive?: boolean };
export type TacticalPlayer = { id: string; name: string; profileImageUrl?: string | null; role: "survivor" | "zombie" | "spectator"; status: string; lat: number | null; lng: number | null; positionKind: "live" | "snapshot" | "hidden"; isHost: boolean; boundaryExposed: boolean };
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

type MapOverlays = { circles: google.maps.Circle[]; lines: google.maps.Polyline[]; markers: Array<google.maps.marker.AdvancedMarkerElement | google.maps.Marker> };

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

function avatarMarkup(player: TacticalPlayer, locationName: string, isSelf: boolean) {
  const initial = player.name.slice(0, 1).toUpperCase();
  const roleClass = player.role === "zombie" ? "infected" : "survivor";
  const image = player.profileImageUrl
    ? `<img src="${player.profileImageUrl}" alt="" />`
    : `<span class="field-map__initial">${initial}</span>`;
  return `<div class="field-map__ping field-map__ping--${roleClass} ${player.positionKind === "snapshot" ? "field-map__ping--snapshot" : ""}"><div class="field-map__avatar">${image}</div><div class="field-map__ping-copy"><strong>${isSelf ? "YOU" : player.name}</strong><span>${player.positionKind === "snapshot" ? "LAST PING" : "LIVE"} · near ${locationName}</span></div></div>`;
}

function itemMarkup(item: TacticalItem) {
  const team = item.faction === "zombie" ? "INFECTED" : "SURVIVORS";
  const icon = item.faction === "zombie" ? "☣" : "✦";
  return `<div class="field-map__pickup field-map__pickup--${item.faction}"><b>${icon}</b><span>${team}<small>${item.type.replaceAll("_", " ")}</small></span></div>`;
}

function placeName(results: google.maps.GeocoderResult[] | null | undefined) {
  const result = results?.find(entry => entry.types.some(type => ["point_of_interest", "premise", "neighborhood", "sublocality", "route"].includes(type))) ?? results?.[0];
  if (!result) return "your last location";
  return result.address_components?.find(component => component.types.some(type => ["point_of_interest", "premise", "neighborhood", "sublocality", "route"].includes(type)))?.long_name ?? result.formatted_address.split(",")[0] ?? "your last location";
}

function makePositionKey(players: TacticalPlayer[]) {
  return players.filter(player => player.lat !== null && player.lng !== null).map(player => `${player.id}:${player.lat!.toFixed(5)}:${player.lng!.toFixed(5)}:${player.positionKind}`).join("|");
}

function Native3DMap({ center, radius, points, players, items, currentPlayerId, labels, map3dRef, onUnavailable }: { center: Props["center"]; radius: number; points: TacticalPoint[]; players: TacticalPlayer[]; items: TacticalItem[]; currentPlayerId: string; labels: Record<string, string>; map3dRef: React.MutableRefObject<any>; onUnavailable: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  useEffect(() => {
    if (!window.google?.maps) return;
    let active = true;
    void window.google.maps.importLibrary("maps3d").then((library: any) => {
      if (!active || !containerRef.current) return;
      const map = new library.Map3DElement({ center: { ...center, altitude: 0 }, range: Math.max(550, radius * 2.6), tilt: 67.5, heading: 28, mode: library.MapMode.HYBRID });
      map.style.width = "100%";
      map.style.height = "100%";
      containerRef.current.replaceChildren(map);
      mapInstanceRef.current = map;
      map3dRef.current = map;
    }).catch(() => onUnavailable());
    return () => { active = false; map3dRef.current = null; containerRef.current?.replaceChildren(); };
  }, []);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;
    void window.google.maps.importLibrary("maps3d").then((library: any) => {
      map.center = { ...center, altitude: 0 };
      map.range = Math.max(550, radius * 2.6);
      map.tilt = 67.5;
      map.heading = 28;
      map.replaceChildren();
      const Marker3DElement = library.Marker3DElement;
      const addMarker = (position: { lat: number; lng: number }, label: string) => map.append(new Marker3DElement({ position: { ...position, altitude: 35 }, label }));
      points.forEach(point => addMarker(point, `${point.type === "extraction" ? "EXIT" : "POWER"} · ${point.label}`));
      items.forEach(item => addMarker(item, `${item.faction === "zombie" ? "INFECTED" : "SURVIVOR"} DROP · ${item.type.replaceAll("_", " ")}`));
      players.filter(player => player.lat !== null && player.lng !== null).forEach(player => addMarker({ lat: player.lat!, lng: player.lng! }, `${player.id === currentPlayerId ? "YOU" : player.name} · near ${labels[player.id] ?? "field location"}`));
    }).catch(() => undefined);
  }, [center, radius, points, players, items, labels, currentPlayerId]);
  return <div ref={containerRef} className="absolute inset-0 z-10" aria-label="Interactive Google 3D city map" />;
}

export default function TacticalMap({ center, radius, points, players, trails, items, currentPlayerId, currentLocation, onMapClick, className }: Props) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<MapOverlays>({ circles: [], lines: [], markers: [] });
  const clickRef = useRef(onMapClick);
  const map3dRef = useRef<any>(null);
  const geocodeCacheRef = useRef(new Map<string, string>());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [is3d, setIs3d] = useState(!onMapClick);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const lastCentreKey = useRef("");
  const playerKey = makePositionKey(players);

  useEffect(() => { clickRef.current = onMapClick; }, [onMapClick]);

  const clearOverlays = () => {
    const overlays = overlaysRef.current;
    overlays.circles.forEach(circle => circle.setMap(null));
    overlays.lines.forEach(line => line.setMap(null));
    overlays.markers.forEach(marker => { (marker as google.maps.marker.AdvancedMarkerElement).map = null; });
    overlaysRef.current = { circles: [], lines: [], markers: [] };
  };

  const createMarker = (map: google.maps.Map, position: google.maps.LatLngLiteral, content: HTMLElement, title: string) => {
    const advanced = window.google?.maps?.marker?.AdvancedMarkerElement;
    if (advanced) return new advanced({ map, position, content, title });
    return new google.maps.Marker({ map, position, title, icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#24e3cf", fillOpacity: 1, strokeColor: "#061014", strokeWeight: 2, scale: 9 } });
  };

  const rebuildOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    clearOverlays();
    const overlays = overlaysRef.current;
    const zone = new google.maps.Circle({ map, center, radius, strokeColor: "#23e0cf", strokeOpacity: 0.95, strokeWeight: 3, fillColor: "#23e0cf", fillOpacity: 0.08, clickable: false });
    overlays.circles.push(zone);
    trails.forEach(trail => overlays.lines.push(new google.maps.Polyline({ map, path: [{ lat: trail.fromLat, lng: trail.fromLng }, { lat: trail.toLat, lng: trail.toLng }], strokeColor: "#ff455c", strokeOpacity: 0.72, strokeWeight: 9, geodesic: true })));
    points.forEach(point => {
      const marker = document.createElement("div");
      marker.className = `field-map__point field-map__point--${point.type}`;
      marker.textContent = point.type === "extraction" ? `EXIT · ${point.label}` : `POWER DROP · ${point.label}`;
      overlays.markers.push(createMarker(map, point, marker, point.label));
    });
    items.forEach(item => {
      const marker = document.createElement("div");
      marker.innerHTML = itemMarkup(item);
      overlays.markers.push(createMarker(map, item, marker, `${item.faction} ${item.type}`));
    });
    players.filter(player => player.lat !== null && player.lng !== null).forEach(player => {
      const marker = document.createElement("div");
      marker.innerHTML = avatarMarkup(player, labels[player.id] ?? "field location", player.id === currentPlayerId);
      overlays.markers.push(createMarker(map, { lat: player.lat!, lng: player.lng! }, marker, `${player.name} near ${labels[player.id] ?? "field location"}`));
    });
  }, [center, radius, trails, points, items, players, labels, currentPlayerId]);

  useEffect(() => { rebuildOverlays(); }, [rebuildOverlays]);

  useEffect(() => {
    if (!mapReady || !window.google?.maps) return;
    const geocoder = new google.maps.Geocoder();
    const positions = players.filter(player => player.lat !== null && player.lng !== null);
    let cancelled = false;
    void Promise.all(positions.map(async player => {
      const key = `${player.lat!.toFixed(4)},${player.lng!.toFixed(4)}`;
      if (geocodeCacheRef.current.has(key)) return [player.id, geocodeCacheRef.current.get(key)!] as const;
      try {
        const response = await geocoder.geocode({ location: { lat: player.lat!, lng: player.lng! } });
        const label = placeName(response.results);
        geocodeCacheRef.current.set(key, label);
        return [player.id, label] as const;
      } catch { return [player.id, "field location"] as const; }
    })).then(entries => {
      if (!cancelled) setLabels(current => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [mapReady, playerKey]);

  const onMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    map.setTilt(62);
    map.setHeading(22);
    map.setZoom(16);
    map.addListener("click", (event: google.maps.MapMouseEvent) => { if (event.latLng) clickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() }); });
    setMapReady(true);
    void wait(150).then(rebuildOverlays);
  }, [rebuildOverlays]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const key = `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${radius}`;
    if (key !== lastCentreKey.current) {
      map.panTo(center);
      if (!lastCentreKey.current) map.setZoom(radius > 1500 ? 13 : radius > 700 ? 14 : 16);
      lastCentreKey.current = key;
    }
  }, [center, radius, mapReady]);

  const recenter = () => {
    if (is3d && map3dRef.current) {
      map3dRef.current.center = { ...(currentLocation ?? center), altitude: 0 };
      map3dRef.current.range = currentLocation ? 500 : Math.max(550, radius * 2.4);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    map.panTo(currentLocation ?? center);
    map.setZoom(currentLocation ? 17 : 16);
    if (currentLocation) map.setTilt(62);
  };
  const toggle3d = () => {
    if (onMapClick) return;
    const map = mapRef.current;
    if (!map) return;
    const next = !is3d;
    setIs3d(next);
    map?.setTilt(next ? 62 : 0);
    map?.setHeading(next ? 22 : 0);
  };

  return <div className={`field-map relative min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a151a] ${className ?? ""}`}>
    <MapView className="absolute inset-0 !h-full" initialCenter={center} initialZoom={16} onMapReady={onMapReady} onLoadError={error => setMapError(error.message)} />
    {is3d && !onMapClick && mapReady && <Native3DMap center={center} radius={radius} points={points} players={players} items={items} currentPlayerId={currentPlayerId} labels={labels} map3dRef={map3dRef} onUnavailable={() => { setIs3d(false); setMapError("Native 3D is unavailable with this maps configuration. Switched to the interactive 2D tactical map."); }} />}
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3"><div className="rounded-xl border border-teal-300/30 bg-[#071116]/90 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-teal-100 shadow-lg"><span className="block text-[9px] text-slate-400">FIELD MAP</span>{is3d ? "3D HYBRID MODE" : "2D HYBRID MODE"}</div>{mapError && <div className="max-w-xs rounded-xl border border-[#ff455c]/50 bg-[#071116]/95 px-3 py-2 text-xs font-bold text-[#ffb2bd]">{mapError}</div>}</div>
    {is3d && !onMapClick && players.filter(player => player.lat !== null && player.lng !== null).length > 0 && <div className="field-map__ping-dock absolute bottom-4 left-4 z-20 flex max-w-[72%] gap-2 overflow-x-auto pb-1">{players.filter(player => player.lat !== null && player.lng !== null).map(player => <div key={player.id} className={`field-map__ping-card ${player.role === "zombie" ? "field-map__ping-card--zombie" : ""}`}><div className="field-map__ping-card-avatar">{player.profileImageUrl ? <img src={player.profileImageUrl} alt={`${player.name} profile ping`} /> : player.name.slice(0, 1).toUpperCase()}</div><div><b>{player.id === currentPlayerId ? "YOU" : player.name}</b><span>{player.positionKind === "snapshot" ? "LAST PING" : "LIVE"} · near {labels[player.id] ?? "field location"}</span></div></div>)}</div>}
    <div className="absolute bottom-4 right-4 z-20 grid gap-2"><button onClick={() => { if (is3d && map3dRef.current) map3dRef.current.range = Math.max(120, (map3dRef.current.range ?? 900) * 0.72); else mapRef.current?.setZoom((mapRef.current.getZoom() ?? 16) + 1); }} className="field-map__control" aria-label="Zoom in"><ZoomIn size={19} /></button><button onClick={() => { if (is3d && map3dRef.current) map3dRef.current.range = Math.min(15_000, (map3dRef.current.range ?? 900) * 1.38); else mapRef.current?.setZoom((mapRef.current.getZoom() ?? 16) - 1); }} className="field-map__control" aria-label="Zoom out"><ZoomOut size={19} /></button>{!onMapClick && <button onClick={toggle3d} className={`field-map__control ${is3d ? "field-map__control--active" : ""}`} aria-label="Toggle 3D map"><Rotate3D size={19} /></button>}<button onClick={recenter} className="field-map__control" aria-label="Recenter map"><Crosshair size={19} /></button></div>
    {!mapReady && <div className="absolute inset-0 z-30 grid place-items-center bg-[#071116]/85 text-center"><MapPinned className="mx-auto mb-3 animate-pulse text-teal-200" /><div className="text-xs font-black tracking-[0.16em] text-teal-100">LOADING FIELD MAP</div></div>}
  </div>;
}
