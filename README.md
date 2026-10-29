# BIM Viewer - IFC Reader (WebGPU + npm)

Przegladarkowy viewer IFC 3D oparty o `three.js` (renderer WebGPU) i `web-ifc`.

## Co robi ta wersja

- pozwala wybrac plik `.ifc`
- parsuje model przez `web-ifc`
- renderuje geometrię IFC w scenie 3D przez `WebGPURenderer`
- pokazuje podstawowe metadane (`IfcProject`, `IfcWall`, `IfcSlab`, `IfcDoor`)
- pozwala kliknac element w scenie (prosta selekcja i podswietlenie)
- raportuje duplikaty geometrii i elementow po zaladowaniu modelu

## Wymagania

- Node.js 20+ (zalecane)
- przegladarka z obsluga WebGPU (np. aktualny Chrome/Edge)

## Jak uruchomic

1. `npm install`
2. `npm run dev`
3. otworz adres pokazany przez Vite (domyslnie `http://localhost:5173`)

## Plik testowy IFC

Przykladowe budynki do testow warstw i kolizji:

1. `samples/test-building.ifc` — prosty 1-kondygnacyjny sample
2. `samples/office-building-with-errors.ifc` — bardziej realistyczny biurowiec 2 kondygnacje z celowymi bledami

Sample realistyczny zawiera m.in.:
- strukture (plyty, sciany zewn./wewn., siatka slupow, belki, dach, fundament)
- architekture (drzwi, okna)
- prad / WodKan / HVAC na parterze i pietrze
- celowe bledy koordynacyjne:
  - `ERROR_Rura_przez_sciane` (WodKan x Struktura)
  - `ERROR_Rura_przez_slup` (WodKan x Struktura)
  - `ERROR_Kanal_przez_belke` (HVAC x Struktura)
  - `ERROR_Oprawa_w_kanale` (Prad x HVAC)
  - `ERROR_Drzwi_w_slupie` (Architektura x Struktura)
  - `ERROR_Pion_przez_plyte` (WodKan x Struktura)
  - `ERROR_Duplikat_rury_A/B` (prawie identyczne rury)

Regeneracja / walidacja:

- `npm run generate:sample-ifc`
- `npm run generate:realistic-sample-ifc`
- `npm run validate:sample-ifc`

## Build produkcyjny

- `npm run build`
- `npm run preview`
