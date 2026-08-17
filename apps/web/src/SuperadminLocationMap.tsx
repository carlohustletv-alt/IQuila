import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { AdminOverview } from "./api";
import "leaflet/dist/leaflet.css";

export default function SuperadminLocationMap({ locations, activeUsers }: { locations: AdminOverview["locations"]; activeUsers: number }) {
  if (!locations.length) return <article className="panel locationPanel"><div className="panelKicker">Field presence</div><h2>User activity map</h2><p className="empty">No GPS-tagged field evidence has been received yet.</p></article>;
  const firstLocation = locations[0]!;
  const center: [number, number] = [firstLocation.latitude, firstLocation.longitude];
  return <article className="panel locationPanel"><div className="panelHeaderRow"><div><div className="panelKicker">Field presence</div><h2>User activity map</h2></div><span className="countPill">{activeUsers} reported</span></div><p className="mapDisclaimer">Locations represent each user&apos;s latest verified field submission, not live tracking. Map tiles are provided by OpenStreetMap.</p><div className="locationMap"><MapContainer center={center} zoom={12} scrollWheelZoom className="locationLeafletMap"><LocationMapViewport locations={locations} /><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{locations.map((item) => <CircleMarker key={item.user_id} center={[item.latitude, item.longitude]} radius={9} pathOptions={{ color: "#fffaf0", fillColor: "#e89225", fillOpacity: 0.95, weight: 3 }}><Popup><strong>{item.full_name || item.email || "Unnamed user"}</strong><br />{item.farm_name}<br />Reported {new Date(item.captured_at).toLocaleString()}</Popup></CircleMarker>)}</MapContainer></div><div className="locationList">{locations.map((item) => <div key={item.user_id}><strong>{item.full_name || item.email || "Unnamed user"}</strong><span>{item.farm_name} · {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)} · {new Date(item.captured_at).toLocaleString()}</span></div>)}</div></article>;
}

function LocationMapViewport({ locations }: { locations: AdminOverview["locations"] }) {
  const map = useMap();
  useEffect(() => {
    const bounds = locations.map((item) => [item.latitude, item.longitude] as [number, number]);
    if (bounds.length === 1) map.setView(bounds[0]!, 13);
    else map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
  }, [locations, map]);
  return null;
}
