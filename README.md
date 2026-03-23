# Lightpath

**An interactive 3D visualization showing how flight paths intersect with Earth's day-night cycle.**

Lightpath calculates the flight trajectory between any two airports and visualizes how the route moves through different light conditions—from full daylight through twilight to darkness. The app uses accurate astronomical calculations to determine the sun's position and render precise twilight gradients along the path.

[lightpath.cc](https://lightpath.cc)

---

## What it does

- **Great circle routing** — Plots the shortest path between airports on a 3D globe
- **Real flight trajectories** — Look up any flight by callsign to trace its actual route using historical flight data
- **Solar illumination mapping** — Color-codes flight segments by daylight, twilight (civil/nautical/astronomical), and darkness
- **Time animation** — Watch flights move through changing light as Earth rotates
- **Astronomical accuracy** — Uses NOAA equations for solar declination and Jean Meeus algorithms for solar position

---

## Tech stack

- **React 19** + **Three.js** for 3D rendering
- **Vite** for build tooling
- **solar-calculator** (NOAA) + **suncalc** for astronomical calculations
- **Custom GLSL shaders** for twilight visualization

---

## Key features

- Real-time solar position calculation
- Latitude-dependent twilight width modeling
- Two search modes: airport-to-airport routing (Great Circle Routes) and flight number lookup
- Animated flight playback with sun position sync
- Color and black-and-white visualization modes
- Shareable flight URLs
- Optional overlays: airport dots, graticule, timezone boundaries, twilight lines

---

## Project structure
```
src/
├── App.jsx              # Main component (3D scene, state, non-panel UI)
├── App.css              # All styles
├── components/
│   ├── AirportSearchInput.jsx
│   ├── FlightInputPanel.jsx
│   ├── AnimationControls.jsx
│   └── ShareButton.jsx
├── services/
│   └── fr24.js          # FlightRadar24 API client
└── utils/
    ├── geoUtils.js      # Coordinate conversion + flight scaling
    ├── solarUtils.js    # Solar position calculations
    ├── sceneUtils.js    # Label texture generation
    ├── animationUtils.js # Fade animations
    ├── routeInterpolation.js # Timestamp interpolation along arc-length
    ├── captureUtils.js  # Screenshot capture for share cards
    ├── cardGenerator.js # Share card image generation
    └── shareUtils.js    # Web Share API wrapper

scripts/
└── build-airports.js    # OurAirports CSV → airports.json

public/
├── airports.json        # Pre-built airport database (~8,400 airports)
├── earth-texture.png    # Custom Earth texture
├── graticule-10.geojson # Latitude/longitude grid
├── timezones.geojson    # Timezone boundaries
└── fonts/               # ABC Repro, ABC Repro Mono
```

---

## Development
```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
```

---

## Credits

Airport data: [OurAirports](https://ourairports.com/data/)
Astronomical calculations: [solar-calculator](https://www.npmjs.com/package/solar-calculator) (NOAA) and [suncalc](https://github.com/mourner/suncalc) (Jean Meeus)
Topography: [NASA](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/)

Designed and developed by [Studio Folder](https://www.studiofolder.it)


---

## License

This work is licensed under a [Creative Commons Attribution-NonCommercial 4.0 International License](https://creativecommons.org/licenses/by-nc/4.0/).

You are free to share and adapt this work with attribution, but not for commercial purposes. For any inquiries, contact folder@studiofolder.it.

© 2026 Studio Folder
