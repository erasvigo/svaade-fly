# Svaade Fly | Operational Flight Planner

**A lightweight, privacy-focused flight planning engine for aviators.**

Svaade Fly is a reliable, browser-based flight planner designed for efficient pre-flight preparation. By running core calculations locally, it ensures maximum privacy and performance without needing backend infrastructure.

## Design Goals

Svaade Fly is built around three principles:

- Reliability
- Privacy
- Operational simplicity

## Key Features

* **Privacy First:** No trackers or telemetry. All flight data and operational calculations remain strictly on your local device.
* **Flight Navigation Engine:** Computes TAS, GS, WCA and ETAs using geodetic calculations via Turf.js.
* **Fuel Management:** Accurate unit conversion (`USG`, `L`, `KG`, `lb`) with real-time `SAFE`, `MINIMUM` and `EMERGENCY` alerts.
* **Interactive Mapping:** Powered by MapLibre GL and OpenAIP. Supports KML imports for plotting custom waypoints and points of interest.
* **Geomagnetic Accuracy:** Built-in NOAA WMM2025 model for precise magnetic variation calculations based on date and location.
* **Professional Navlogs:** Generates flight-ready A4 navlogs with an optional high-contrast monochrome mode for maximum readability and economical printing.
* **Responsive Design:** Seamlessly transitions from multi-column desktop workflows to optimized mobile layouts.

![Svaade Fly Screenshot](docs/screenshot.png)

## Technology Stack

## Technology Stack

- **HTML5 / CSS3 / JavaScript** (Core frontend)
- **MapLibre GL** (Interactive map rendering)
- **Turf.js** (Advanced geospatial and geodetic calculations)
- **OpenAIP** (Aeronautical data and airspace layers)
- **NOAA WMM2025** (Magnetic variation modeling via `newGeomag.js`)
- **jsPDF & jsPDF-AutoTable** (Client-side professional PDF generation)
- **toGeoJSON** (Local parsing of KML files into GeoJSON)
- **LocationIQ** (Reverse geocoding API for waypoint naming)
- **CARTO Basemaps & OpenStreetMap** (Base map tiles)

## Installation & Deployment

* **Web Mode:** An internet connection is required only for initial map tile caching and reverse geocoding. Once loaded, operational calculations continue offline.
``` bash
    git clone https://github.com/erasvigo/svaade-fly.git
    cd svaade-fly
    python3 -m http.server 8000
```
* **Desktop Mode:** Package via Electron to bundle all assets into a standalone native executable for Linux, Windows or macOS.
``` bash
    npm install
    npm run dist
```

---
*Copyright (c) 2026 Erasmo Alonso Iglesias. All rights reserved.*