// SoloStrike Globe Renderer (rev39).
//
// Replaces the custom WebGL implementation with react-globe.gl, a
// production-tested library built on Three.js. Solves the polar pinch
// artifact, lets the user drag freely (yaw + pitch).
//
// Props:
//   peers          — array of network peer objects (with pubkey, loc, isOwn)
//   ownPin         — { lat, lon } in degrees, or null (overrides own peer's loc)
//   onTap          — function called with { lat, lng } in degrees on globe click
//   placingPin     — bool; when true, dim overlay + auto-rotate paused
//   landRings      — array of [lon, lat] degree pairs for texture bake
//   width, height  — container dimensions (CSS pixels)

import React, { useEffect, useRef, useState, useMemo } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

const AMBER_LAND   = 'rgb(240,165,40)';
const OCEAN_DARK   = 'rgb(15,12,8)';
const ATM_AMBER    = '#f5a623';
const PIN_CRIMSON  = '#A8170E';

// Bake equirectangular amber texture from rings.
function bakeTexture(rings) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = OCEAN_DARK;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = AMBER_LAND;
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let started = false;
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      const x = (lon + 180) / 360 * W;
      const y = (90 - lat) / 180 * H;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Stable hash → [-1, 1] from a pubkey string. Used for peers without a
// real broadcast location, so their position stays put across frames
// instead of jittering each render.
function hashToUnit(str, salt) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  h = ((h << 5) + h + salt) | 0;
  return ((h % 10000) / 10000) * 2 - 1;
}

// Fallback marker position from pubkey hash. Picks a "land-friendly"
// area by biasing toward continental lat/lon ranges.
function fallbackLatLon(pubkey) {
  const u = hashToUnit(pubkey || 'unknown', 17);
  const v = hashToUnit(pubkey || 'unknown', 31);
  // Bias toward populated continents
  const lat = u * 50; // -50° to +50°
  const lon = v * 180; // -180° to +180°
  return { lat, lon };
}

export default function GlobeRenderer({
  peers = [],
  ownPin = null,
  onTap = null,
  placingPin = false,
  landRings = null,
  width = 380,
  height = 380,
}) {
  const globeRef = useRef();
  const [globeMaterial, setGlobeMaterial] = useState(null);
  const materialRef = useRef(null);

  // Bake texture when landRings becomes available
  useEffect(() => {
    if (!landRings || landRings.length === 0) return;
    const tex = bakeTexture(landRings);
    const mat = new THREE.MeshPhongMaterial({
      map: tex,
      color: 0xffffff,
      shininess: 6,
    });
    // dispose old before swap
    if (materialRef.current) {
      const oldMat = materialRef.current;
      if (oldMat.map) oldMat.map.dispose();
      oldMat.dispose();
    }
    materialRef.current = mat;
    setGlobeMaterial(mat);
    return () => {
      // dispose handled at next bake or on unmount
    };
  }, [landRings]);

  // On unmount, dispose material
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        if (materialRef.current.map) materialRef.current.map.dispose();
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);

  // Configure controls + camera once globe is ready
  useEffect(() => {
    if (!globeRef.current || !globeMaterial) return;
    const g = globeRef.current;
    g.controls().autoRotate = !placingPin;
    g.controls().autoRotateSpeed = 0.4;
    g.controls().enableZoom = false;
    g.controls().enablePan = false;
    g.controls().rotateSpeed = 0.7;
    const lights = g.lights();
    lights.forEach(l => {
      if (l.type === 'AmbientLight') l.intensity = 0.45;
      if (l.type === 'DirectionalLight') {
        l.intensity = 1.1;
        l.position.set(-1, 1, 1);
      }
    });
    g.pointOfView({ lat: 25, lng: -20, altitude: 2.0 }, 0);
  }, [globeMaterial]);

  // Keep auto-rotate in sync with placingPin
  useEffect(() => {
    if (!globeRef.current || !globeMaterial) return;
    globeRef.current.controls().autoRotate = !placingPin;
  }, [placingPin, globeMaterial]);

  // Build markers from peers + ownPin
  const markersData = useMemo(() => {
    const out = [];
    for (const p of peers || []) {
      if (p.filtered) continue;
      let lat, lon;
      if (p.isOwn && ownPin) {
        lat = ownPin.lat;
        lon = ownPin.lon;
      } else if (Array.isArray(p.loc) && p.loc.length === 2
                 && Number.isFinite(p.loc[0]) && Number.isFinite(p.loc[1])) {
        lat = p.loc[0];
        lon = p.loc[1];
      } else {
        const fb = fallbackLatLon(p.pubkey);
        lat = fb.lat;
        lon = fb.lon;
      }
      out.push({ lat, lng: lon, isOwn: !!p.isOwn });
    }
    // Ensure own pin shows even before broadcast echoes back
    if (ownPin && !out.some(m => m.isOwn)) {
      out.push({ lat: ownPin.lat, lng: ownPin.lon, isOwn: true });
    }
    return out;
  }, [peers, ownPin]);

  const ringsData = useMemo(() => {
    return markersData.filter(m => m.isOwn);
  }, [markersData]);

  if (!globeMaterial) {
    return (
      <div style={{
        width, height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(245,166,35,0.6)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '0.7rem',
      }}>
        ⟳ Loading globe...
      </div>
    );
  }

  return (
    <div style={{ width, height, position: 'relative' }}>
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={globeMaterial}
        showAtmosphere={true}
        atmosphereColor={ATM_AMBER}
        atmosphereAltitude={0.18}
        pointsData={markersData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => PIN_CRIMSON}
        pointRadius={0.4}
        pointAltitude={0.005}
        pointResolution={12}
        ringsData={ringsData}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => (t) => `rgba(57,255,106,${0.85 * (1 - t)})`}
        ringMaxRadius={1.5}
        ringPropagationSpeed={2}
        ringRepeatPeriod={1500}
        ringAltitude={0.006}
        onGlobeClick={onTap ? ({ lat, lng }) => onTap({ lat, lng }) : undefined}
      />
      {placingPin && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(245,166,35,0.95)',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.65rem', letterSpacing: '0.12em',
          textTransform: 'uppercase',
          textShadow: '0 0 6px rgba(0,0,0,0.8)',
        }}>
          ↻ Tap globe to place pin
        </div>
      )}
    </div>
  );
}
