# BIM Viewer

Przeglądarkowa aplikacja do wizualizacji i walidacji modeli BIM w formacie IFC.
Działa w całości po stronie klienta — pliki IFC nie opuszczają komputera użytkownika.

Zbudowana na `three.js` (`WebGPURenderer`, z automatycznym przejściem na WebGL 2,
gdy WebGPU jest niedostępne) oraz `web-ifc` (parser IFC w WebAssembly).

## Funkcje

- wczytywanie jednego lub wielu plików `.ifc` jednocześnie (modele wielobranżowe),
- podział elementów na warstwy branżowe (konstrukcja, stolarka, elektryka, wod-kan, HVAC, MEP)
  oraz własne warstwy powiązane z plikiem lub typem encji,
- sterowanie widocznością i przezroczystością warstw,
- wykrywanie kolizji między warstwami: faza wstępna AABB, faza dokładna trójkąt–trójkąt
  oraz test zawierania, z regulowaną tolerancją,
- wskazanie wybranej kolizji lub grupy duplikatów w scenie: elementy rysowane ponad modelem, ramka w miejscu problemu, przyciemnienie reszty modelu, przejście kamerą (podwójne kliknięcie), powrót klawiszem Esc,
- statusy kolizji i grup duplikatów (Do sprawdzenia / Potwierdzony / Ignoruj) zapamiętywane w `localStorage` dla pliku, z filtrowaniem list,
- tryb izolacji kolizji (pomija pary o statusie „Ignoruj”),
- wykrywanie duplikatów (powtórzony `GlobalId`, pokrywająca się geometria),
- raport: zestawienie materiałów i objętości oraz powierzchnie ścian i stropów
  z podziałem na kondygnacje,
- ręczne wyrównywanie modeli z różnych plików (przesunięcie, obrót), zapamiętywane w `localStorage`,
- pamięć podręczna przetworzonej geometrii w IndexedDB (szybsze ponowne wczytanie tego samego pliku).

## Wymagania

- Node.js `^20.19.0` lub `>=22.12.0` (wymóg Vite 8),
- aktualna przeglądarka Chrome lub Edge.

## Uruchomienie

```bash
npm install
npm run dev
```

Aplikacja jest dostępna pod adresem wypisanym przez Vite (domyślnie `http://localhost:5173`).

## Wersja produkcyjna

```bash
npm run build     # wynik w katalogu dist/
npm run preview   # lokalny podgląd zbudowanej wersji
```

Katalog `dist/` jest w pełni statyczny i używa ścieżek względnych (`base: "./"`),
więc można go umieścić na dowolnym serwerze plików statycznych, także w podkatalogu.
Serwer musi zwracać pliki `.wasm` z typem `application/wasm`.

Wielowątkowa wersja `web-ifc` jest używana tylko wtedy, gdy strona jest
izolowana międzydomenowo (nagłówki `Cross-Origin-Opener-Policy: same-origin`
i `Cross-Origin-Embedder-Policy: require-corp`); w przeciwnym razie działa wersja jednowątkowa.

## Struktura

| Ścieżka | Zawartość |
| --- | --- |
| `index.html`, `styles.css`, `main.js` | powłoka aplikacji i spięcie modułów |
| `src/viewer.js` | scena, kamery, renderer, wskazywanie obiektów |
| `src/ifc-service.js` | wczytywanie IFC, budowa geometrii (`BatchedMesh`) |
| `src/ifc-cache.js` | pamięć podręczna geometrii w IndexedDB |
| `src/disciplines.js` | klasyfikacja elementów do branż |
| `src/layer-manager.js` | warstwy domyślne i własne |
| `src/collisions.js`, `src/triangle-intersection.js` | wykrywanie kolizji |
| `src/duplicates.js` | wykrywanie duplikatów |
| `src/materials.js`, `src/material-takeoff.js`, `src/spatial-areas.js` | materiały, przedmiar, powierzchnie |
| `src/file-alignment.js` | wyrównywanie modeli z wielu plików |
| `src/entities.js`, `src/selection.js`, `src/ui.js`, `src/constants.js` | model encji, zaznaczanie, interfejs |
| `public/wasm/` | binaria `web-ifc` serwowane lokalnie |
| `scripts/` | narzędzia deweloperskie do danych testowych (nie wchodzą do wersji produkcyjnej) |

## Dane testowe

Aplikacja nie zawiera wbudowanych modeli. Modele testowe z celowo wprowadzonymi
błędami koordynacyjnymi generuje się lokalnie (wynik jest deterministyczny):

```bash
npm run testdata:generate   # tworzy test-models/*.ifc
npm run testdata:validate   # sprawdza, czy web-ifc poprawnie je otwiera
```

Katalog `test-models/` jest pomijany przez git. Powstają w nim:

- `test-building.ifc` — prosty budynek jednokondygnacyjny,
- `office-building-with-errors.ifc` — dwukondygnacyjny biurowiec (konstrukcja, stolarka,
  elektryka, wod-kan, HVAC) z elementami `ERROR_*`: rury przechodzące przez ścianę, słup i strop,
  rura w całości wewnątrz słupa (test zawierania), kanał przez belkę, oprawa w kanale,
  drzwi w słupie, zdublowana rura oraz powtórzony `GlobalId`,
- `materials-systems.ifc` — elementy z warstwami i składnikami materiałowymi, ilościami `Qto`
  oraz segmenty przypisane do systemów instalacyjnych (test przedmiaru i klasyfikacji branż),
- `scaling-S|M|L|XL.ifc` — modele o rosnącej liczbie elementów (ok. 1, 5, 19 i 50 tys.)
  ze znaną liczbą kolizji Konstrukcja × WodKan (2 na kondygnację),
- `*.oracle.json` — wyniki referencyjne (pary przenikające i stykające się, objętości, powierzchnie)
  wyliczone wprost z tekstu pliku IFC przez `scripts/build-oracle.mjs`, bez `web-ifc` i `three.js`.

Oba pierwsze pliki zawierają element o tym samym `GlobalId`, więc po wczytaniu ich razem
panel duplikatów powinien pokazać jedną grupę `GlobalId`.

## Testy

```bash
npm test                    # testy jednostkowe (Vitest), katalog tests/unit
```

Testy integracyjne i pomiary wydajności działają w przeglądarce, na prawdziwych modułach aplikacji:

```bash
npm run testdata:generate
npm run dev
# http://localhost:5173/tests/bench/                   – WebGPU (lub automatycznie WebGL 2)
# http://localhost:5173/tests/bench/?renderer=webgl    – wymuszony WebGL 2
# parametry: ?autorun=all|validation|calculations|performance|render  ?sizes=S,M,L,XL  ?runs=5
```

Wyniki są zapisywane w `tests/results/<zestaw>-<renderer>.json`. Karta przeglądarki musi być
widoczna — w tle przeglądarka wstrzymuje `requestAnimationFrame` i pomiar renderowania jest
nieważny (pole `stalledFrames` > 0).

Sama aplikacja również przyjmuje parametr `?renderer=webgl`, który wymusza WebGL 2.

## Ograniczenia

- faza wstępna wykrywania kolizji porównuje wszystkie pary elementów dwóch warstw (O(n·m));
  struktura przyspieszająca (np. BVH) nie jest zaimplementowana,
- klucz pamięci podręcznej powstaje z nazwy pliku, rozmiaru oraz skrótu SHA-256 początku i końca pliku
  (po 64 KiB), a nie z pełnej zawartości — plik zmieniony wyłącznie w środku, bez zmiany rozmiaru,
  zostanie odczytany z pamięci podręcznej,
- obsługiwane są pliki `.ifc` (STEP); `.ifczip` i `.ifcxml` nie są obsługiwane.
