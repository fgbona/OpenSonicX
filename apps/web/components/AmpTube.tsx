/**
 * An illustrated power tube for the AMP faceplate: glass with reflections, the silver getter
 * flash at the top, plates and mica spacers inside, a glowing heater, and the base with its pins.
 * Ids are prefixed: only one AMP panel is on screen at a time.
 */
export function AmpTube() {
  return (
    <svg className="amp-tube" viewBox="0 0 64 150" aria-hidden="true">
      <defs>
        <radialGradient id="amp-tube-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff8a3d" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#ff5a1f" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ff5a1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="amp-tube-glass" x1="0" x2="1">
          <stop offset="0" stopColor="#cfe3ff" stopOpacity="0.22" />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="0.55" stopColor="#9fb4c8" stopOpacity="0.05" />
          <stop offset="0.9" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#dbe9ff" stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id="amp-tube-getter" x1="0" x2="1">
          <stop offset="0" stopColor="#4a4f57" />
          <stop offset="0.3" stopColor="#c9ced6" />
          <stop offset="0.5" stopColor="#7c828c" />
          <stop offset="0.75" stopColor="#2b2e33" />
          <stop offset="1" stopColor="#5d636c" />
        </linearGradient>
        <linearGradient id="amp-tube-plate" x1="0" x2="1">
          <stop offset="0" stopColor="#2a2c30" />
          <stop offset="0.4" stopColor="#5b5f66" />
          <stop offset="0.6" stopColor="#3b3e43" />
          <stop offset="1" stopColor="#1d1f22" />
        </linearGradient>
        <linearGradient id="amp-tube-base" x1="0" x2="1">
          <stop offset="0" stopColor="#141414" />
          <stop offset="0.35" stopColor="#3a3a3a" />
          <stop offset="1" stopColor="#0b0b0b" />
        </linearGradient>
        <linearGradient id="amp-tube-pin" x1="0" x2="1">
          <stop offset="0" stopColor="#8a8f96" />
          <stop offset="0.5" stopColor="#e4e7eb" />
          <stop offset="1" stopColor="#7a7f86" />
        </linearGradient>
        <filter id="amp-tube-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* Warm light spilling around the tube */}
      <ellipse cx="32" cy="74" rx="34" ry="46" fill="url(#amp-tube-halo)" className="amp-tube-halo" />

      {/* Pins and base */}
      {[16, 22, 28, 36, 42, 48].map((x) => <rect key={x} x={x - 1} y="128" width="2" height="16" rx="1" fill="url(#amp-tube-pin)" />)}
      <rect x="12" y="118" width="40" height="13" rx="4" fill="url(#amp-tube-base)" />
      <rect x="12" y="118" width="40" height="2.5" rx="1.2" fill="#555" opacity="0.6" />

      {/* Inside: support rods, mica spacers, plates, grid wires and the glowing heater */}
      <line x1="20" y1="34" x2="20" y2="114" stroke="#8d939b" strokeWidth="0.9" />
      <line x1="44" y1="34" x2="44" y2="114" stroke="#8d939b" strokeWidth="0.9" />
      <rect x="22" y="44" width="20" height="52" rx="1.5" fill="url(#amp-tube-plate)" />
      <rect x="30.2" y="46" width="3.6" height="48" fill="#120a06" />
      <g className="amp-tube-heater">
        <rect x="29.5" y="44" width="5" height="52" fill="#ff7a2e" filter="url(#amp-tube-blur)" opacity="0.95" />
        <line x1="32" y1="46" x2="32" y2="94" stroke="#ffd29a" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      {[52, 60, 68, 76, 84].map((y) => <line key={y} x1="23" y1={y} x2="41" y2={y} stroke="#a7acb3" strokeWidth="0.35" opacity="0.6" />)}
      <ellipse cx="32" cy="41" rx="15" ry="3.2" fill="#e9e3d2" opacity="0.55" stroke="#b8b09a" strokeWidth="0.5" />
      <ellipse cx="32" cy="99" rx="15" ry="3.2" fill="#e9e3d2" opacity="0.5" stroke="#b8b09a" strokeWidth="0.5" />
      {[24, 28, 36, 40].map((x) => <line key={x} x1={x} y1="101" x2={x - 2 + (x > 32 ? 4 : 0)} y2="118" stroke="#9aa0a7" strokeWidth="0.6" />)}

      {/* Glass envelope with the getter flash at the top */}
      <path d="M14 116 V28 C14 16 20 10 32 10 C44 10 50 16 50 28 V116 Z" fill="url(#amp-tube-glass)" stroke="rgba(230,240,255,0.55)" strokeWidth="0.9" />
      <path d="M14.6 30 C14.6 18 20.5 11 32 11 C43.5 11 49.4 18 49.4 30 L49.4 34 C42 31 22 31 14.6 34 Z" fill="url(#amp-tube-getter)" opacity="0.92" />
      <path d="M28 10.5 C28 6 30 3 32 3 C34 3 36 6 36 10.5 Z" fill="url(#amp-tube-glass)" stroke="rgba(230,240,255,0.6)" strokeWidth="0.7" />

      {/* Reflections */}
      <rect x="17" y="18" width="3.2" height="92" rx="1.6" fill="#ffffff" opacity="0.55" />
      <rect x="21.5" y="22" width="1.2" height="80" rx="0.6" fill="#ffffff" opacity="0.25" />
      <rect x="45.5" y="26" width="1.6" height="84" rx="0.8" fill="#ffffff" opacity="0.22" />
      <ellipse cx="24" cy="20" rx="4" ry="2.2" fill="#ffffff" opacity="0.45" />
    </svg>
  );
}
