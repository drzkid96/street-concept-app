# Street Concept App

One flow, one project file: **site → existing → alternatives → cost → visualize → sheets → review → handoff**.
Southern California standards; every rule links to its [SoCal Super Standards](https://drzkid96.github.io/SoCal-Super-Standards/) page.
Colours and type follow SoCal Super Standards (F&P palette, Albert Sans).

## Stack
Vite + TypeScript, no framework. Static build deployed to GitHub Pages by `.github/workflows/deploy.yml`.

| Path | Purpose |
|---|---|
| `src/lib/types.ts` | Project file types; the section is the spine |
| `src/lib/project.ts` | Project state, local save, import/export JSON |
| `src/lib/standards.ts` | Element catalogue, rules (placeholder values, `verified: false`), F&P conventions |
| `src/lib/sectionSvg.ts` | Scaled cross-section drawing (green bike lanes, red bus lanes with BUS LANE) |
| `src/lib/maps.ts` | Google Maps loader |
| `src/stages/` | One module per stage |
| `docs/outline.html` | Build outline |

## Status
Working: stage navigation, project save/import/export, map with segment drawing and length, geocoder search,
existing and alternative section editors with standards flags, changed-area quantities.
Placeholders: Street View capture, unit costs, renderings, sheets, markup review, DXF/DWG.

## Google Maps key
Enabled APIs: Maps JavaScript, Street View Static, Maps Static, Map Tiles, Geocoding, Places (New), Roads, Maps Elevation, Drive, Sheets.
Create a browser key restricted to referrers `https://drzkid96.github.io/street-concept-app/*` and `http://localhost:5173/*`
and to the eight Maps APIs. Save it as repo secret `VITE_GOOGLE_MAPS_KEY`; locally, copy `.env.example` to `.env.local`.
Drive, Sheets and the Claude API need OAuth or a server proxy, never a browser key.

## Develop
```
npm install
npm run dev
npm run build
```
Pages: Settings → Pages → Source: GitHub Actions.

## Build phases
0. Schema, standards registry, unit cost data
1. Section editor, cost estimate, 11x17 sheet export
2. Map, segment, Street View capture, key maps
3. Markup review with JSON export
4. Curb tool and asset renderings
5. Optional Claude API hooks; DXF/DWG export
