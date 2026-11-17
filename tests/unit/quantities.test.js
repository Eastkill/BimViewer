import { describe, expect, it } from "vitest";
import { computeEntityOneSidedSurfaceArea } from "../../src/entities.js";
import {
  allocateElementMaterials,
  computeEntityMeshVolume,
  extractMaterialParts,
  extractQuantitiesFromPsets,
  formatVolume
} from "../../src/material-takeoff.js";
import { formatArea } from "../../src/spatial-areas.js";
import { buildModel } from "./helpers.js";

const IFC_MATERIAL = 1838606355;
const IFC_MATERIAL_LAYER = 248100487;
const IFC_MATERIAL_LAYER_SET = 3303938423;
const IFC_MATERIAL_LAYER_SET_USAGE = 1303795690;
const IFC_MATERIAL_CONSTITUENT = 3708119000;
const IFC_MATERIAL_CONSTITUENT_SET = 2852063980;

const material = (id, name) => ({ expressID: id, type: IFC_MATERIAL, Name: { value: name } });
const layer = (id, name, thickness) => ({
  expressID: id,
  type: IFC_MATERIAL_LAYER,
  Material: material(id + 100, name),
  LayerThickness: { value: thickness }
});
const sumVolumes = (allocations) => allocations.reduce((sum, item) => sum + item.volume, 0);

describe("computeEntityMeshVolume", () => {
  it("objętość prostopadłościanu jest równa iloczynowi wymiarów", () => {
    const { entities } = buildModel([{ min: [0, 0, 0], max: [2, 3, 4] }]);
    expect(computeEntityMeshVolume(entities[0])).toBeCloseTo(24, 5);
  });

  it("nie zależy od położenia i obrotu bryły", () => {
    const { entities } = buildModel([
      { min: [100, -50, 20], max: [102, -47, 24] },
      { min: [0, 0, 0], max: [2, 3, 4], rotationY: 0.7 }
    ]);
    expect(computeEntityMeshVolume(entities[0])).toBeCloseTo(24, 3);
    expect(computeEntityMeshVolume(entities[1])).toBeCloseTo(24, 4);
  });

  it("zwraca 0 dla encji bez geometrii", () => {
    expect(computeEntityMeshVolume(null)).toBe(0);
    expect(computeEntityMeshVolume({})).toBe(0);
  });
});

describe("computeEntityOneSidedSurfaceArea", () => {
  // Ściana 6 m × 3 m (wysokość wzdłuż Y) × 0,4 m grubości. Strona: 18 m².
  // Metoda dolicza połowę czół: (2·18 + 2·1,2) / 2 = 19,2 m².
  it("ściana wzdłuż osi X", () => {
    const { entities } = buildModel([{ min: [0, 0, 0], max: [6, 3, 0.4] }]);
    expect(computeEntityOneSidedSurfaceArea(entities[0])).toBeCloseTo(19.2, 4);
  });

  it("ściana wzdłuż osi Z daje ten sam wynik", () => {
    const { entities } = buildModel([{ min: [0, 0, 0], max: [0.4, 3, 6] }]);
    expect(computeEntityOneSidedSurfaceArea(entities[0])).toBeCloseTo(19.2, 4);
  });

  it("ściana ukośna daje ten sam wynik", () => {
    const { entities } = buildModel([{ min: [0, 0, 0], max: [6, 3, 0.4], rotationY: Math.PI / 4 }]);
    expect(computeEntityOneSidedSurfaceArea(entities[0])).toBeCloseTo(19.2, 3);
  });

  it("pomija powierzchnie poziome (płyta nie ma powierzchni bocznej poza krawędziami)", () => {
    const { entities } = buildModel([{ min: [0, 0, 0], max: [10, 0.2, 10] }]);
    // tylko cztery krawędzie: 4 · (10 · 0,2) / 2 = 4 m²
    expect(computeEntityOneSidedSurfaceArea(entities[0])).toBeCloseTo(4, 4);
  });
});

describe("extractQuantitiesFromPsets", () => {
  it("odczytuje objętość i powierzchnię z zestawu ilości", () => {
    const result = extractQuantitiesFromPsets([
      {
        Quantities: [
          { Name: { value: "NetSideArea" }, AreaValue: { value: 18 } },
          { Name: { value: "NetVolume" }, VolumeValue: { value: 7.2 } }
        ]
      }
    ]);
    expect(result).toMatchObject({ volume: 7.2, volumeName: "NetVolume", area: 18, areaName: "NetSideArea" });
  });

  it("ignoruje wartości niedodatnie i puste zestawy", () => {
    expect(extractQuantitiesFromPsets([{ Quantities: [{ Name: { value: "NetVolume" }, VolumeValue: { value: 0 } }] }]).volume).toBeNull();
    expect(extractQuantitiesFromPsets([])).toMatchObject({ volume: null, area: null });
    expect(extractQuantitiesFromPsets([{}])).toMatchObject({ volume: null, area: null });
  });
});

describe("extractMaterialParts", () => {
  it("pojedynczy materiał", () => {
    expect(extractMaterialParts([material(1, "Beton")])).toEqual([{ name: "Beton", thickness: null }]);
  });

  it("zestaw warstw z użyciem (LayerSetUsage) zachowuje grubości i kolejność", () => {
    const usage = {
      expressID: 10,
      type: IFC_MATERIAL_LAYER_SET_USAGE,
      ForLayerSet: {
        expressID: 11,
        type: IFC_MATERIAL_LAYER_SET,
        MaterialLayers: [layer(12, "Cegla", 0.25), layer(13, "Welna", 0.12), layer(14, "Tynk", 0.03)]
      }
    };
    expect(extractMaterialParts([usage])).toEqual([
      { name: "Cegla", thickness: 0.25 },
      { name: "Welna", thickness: 0.12 },
      { name: "Tynk", thickness: 0.03 }
    ]);
  });

  it("zestaw składników nie ma grubości", () => {
    const set = {
      expressID: 20,
      type: IFC_MATERIAL_CONSTITUENT_SET,
      MaterialConstituents: [
        { expressID: 21, type: IFC_MATERIAL_CONSTITUENT, Material: material(22, "Stal") },
        { expressID: 23, type: IFC_MATERIAL_CONSTITUENT, Material: material(24, "Beton") }
      ]
    };
    expect(extractMaterialParts([set])).toEqual([
      { name: "Stal", thickness: null },
      { name: "Beton", thickness: null }
    ]);
  });

  it("ta sama definicja zwrócona dwukrotnie (element i typ) jest liczona raz", () => {
    const concrete = material(1, "Beton");
    expect(extractMaterialParts([concrete, concrete])).toHaveLength(1);
  });

  it("brak materiałów", () => {
    expect(extractMaterialParts([])).toEqual([]);
    expect(extractMaterialParts(null)).toEqual([]);
  });
});

describe("allocateElementMaterials", () => {
  const layers = [
    { name: "Cegla", thickness: 0.25 },
    { name: "Welna", thickness: 0.12 },
    { name: "Tynk", thickness: 0.03 }
  ];

  it("warstwy + powierzchnia: objętość = powierzchnia × grubość", () => {
    const result = allocateElementMaterials({ parts: layers, volume: 7.2, area: 18 });
    expect(result.map((item) => [item.name, Number(item.volume.toFixed(4))])).toEqual([
      ["Cegla", 4.5],
      ["Welna", 2.16],
      ["Tynk", 0.54]
    ]);
    expect(sumVolumes(result)).toBeCloseTo(7.2, 6);
  });

  it("warstwy bez powierzchni: podział proporcjonalny do grubości", () => {
    const result = allocateElementMaterials({ parts: layers, volume: 4.8, area: null });
    expect(result.map((item) => [item.name, Number(item.volume.toFixed(4))])).toEqual([
      ["Cegla", 3],
      ["Welna", 1.44],
      ["Tynk", 0.36]
    ]);
    expect(sumVolumes(result)).toBeCloseTo(4.8, 6);
  });

  it("składniki bez grubości: podział równy", () => {
    const result = allocateElementMaterials({
      parts: [
        { name: "Stal", thickness: null },
        { name: "Beton", thickness: null }
      ],
      volume: 0.6,
      area: null
    });
    expect(result.map((item) => item.volume)).toEqual([0.3, 0.3]);
  });

  it("pojedynczy materiał otrzymuje całą objętość", () => {
    const result = allocateElementMaterials({ parts: [{ name: "Beton", thickness: null }], volume: 0.48, area: null });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Beton", volume: 0.48 });
  });

  it("brak materiału: pozycja zbiorcza", () => {
    const result = allocateElementMaterials({ parts: [], volume: 0.2, area: null });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Brak / nieprzypisany");
    expect(result[0].volume).toBe(0.2);
  });

  it("brak objętości: brak pozycji", () => {
    expect(allocateElementMaterials({ parts: [], volume: 0, area: null })).toEqual([]);
  });
});

describe("formatowanie", () => {
  it("formatVolume / formatArea dobierają liczbę miejsc po przecinku do rzędu wielkości", () => {
    expect(formatVolume(640.61)).toBe("640.6");
    expect(formatVolume(12.284)).toBe("12.28");
    expect(formatVolume(0.4812)).toBe("0.481");
    expect(formatVolume(0)).toBe("0");
    expect(formatArea(512)).toBe("512.0");
    expect(formatArea(39.36)).toBe("39.36");
  });
});
