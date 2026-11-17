import { describe, expect, it } from "vitest";
import { buildElementSystemHints, DISCIPLINES, resolveDiscipline } from "../../src/disciplines.js";
import { createLayerManager } from "../../src/layer-manager.js";
import { buildModel } from "./helpers.js";

const IFCWALL = 2391406946;
const IFCDOOR = 395920057;
const IFCPIPESEGMENT = 3612865200;
const IFCDUCTSEGMENT = 3518393246;
const IFCLIGHTFIXTURE = 629592764;
const IFCFLOWSEGMENT = 987401354;
const IFCRELASSIGNSTOGROUP = 1307041759;
const IFCDISTRIBUTIONSYSTEM = 3205830791;
const IFCBUILDINGELEMENTPROXY = 1095909175;

describe("resolveDiscipline", () => {
  it("typy jednoznaczne rozstrzygają o branży", () => {
    expect(resolveDiscipline({ typeId: IFCWALL })).toBe(DISCIPLINES.STRUCTURE);
    expect(resolveDiscipline({ typeId: IFCDOOR })).toBe(DISCIPLINES.ARCHITECTURE);
    expect(resolveDiscipline({ typeId: IFCPIPESEGMENT })).toBe(DISCIPLINES.WATER_SEWAGE);
    expect(resolveDiscipline({ typeId: IFCDUCTSEGMENT })).toBe(DISCIPLINES.HVAC);
    expect(resolveDiscipline({ typeId: IFCLIGHTFIXTURE })).toBe(DISCIPLINES.ELECTRICAL);
  });

  it("typ jednoznaczny ma pierwszeństwo przed wskazówkami tekstowymi", () => {
    expect(
      resolveDiscipline({ typeId: IFCPIPESEGMENT, line: { Name: { value: "Kanal wentylacyjny" } } })
    ).toBe(DISCIPLINES.WATER_SEWAGE);
  });

  const name = (value) => ({ Name: { value } });

  it("typ ogólny: branża z nazwy elementu", () => {
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Pipe DN50") })).toBe(DISCIPLINES.WATER_SEWAGE);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Przewod kanalizacyjny") })).toBe(
      DISCIPLINES.WATER_SEWAGE
    );
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Duct 400x200") })).toBe(DISCIPLINES.HVAC);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Nawiew N1") })).toBe(DISCIPLINES.HVAC);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Cable tray 200") })).toBe(DISCIPLINES.ELECTRICAL);
  });

  // Charakterystyka znanych słabości heurystyki tekstowej (rozdz. 4.3.1) — nie są to wyniki pożądane.
  it("znane ograniczenie: „kanał wentylacyjny” jest dopasowywany do fragmentu „kanal” (WodKan)", () => {
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Kanal wentylacyjny") })).toBe(
      DISCIPLINES.WATER_SEWAGE
    );
  });

  it("znane ograniczenie: polskie „rura” nie jest wskazówką i element trafia do MEP", () => {
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: name("Rura PVC 110") })).toBe(DISCIPLINES.MEP);
  });

  it("typ ogólny: branża ze wskazówki systemu lub pliku", () => {
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, systemHint: "wentylacja nawiewna n1" })).toBe(DISCIPLINES.HVAC);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, systemHint: "instalacja cwu" })).toBe(DISCIPLINES.WATER_SEWAGE);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, systemHint: "projekt_hvac.ifc" })).toBe(DISCIPLINES.HVAC);
  });

  it("typ ogólny bez wskazówek trafia do MEP", () => {
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT })).toBe(DISCIPLINES.MEP);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, line: { Name: { value: "Segment_D" } } })).toBe(DISCIPLINES.MEP);
  });

  it("typ nieznany trafia do Inne, niezależnie od nazwy", () => {
    expect(resolveDiscipline({ typeId: IFCBUILDINGELEMENTPROXY, line: { Name: { value: "Pipe" } } })).toBe(
      DISCIPLINES.OTHER
    );
  });
});

describe("buildElementSystemHints", () => {
  const lines = new Map([
    [100, { RelatingGroup: { value: 200 }, RelatedObjects: [{ value: 1 }, { value: 2 }] }],
    [101, { RelatingGroup: { value: 201 }, RelatedObjects: [{ value: 2 }] }],
    [200, { Name: { value: "Wentylacja nawiewna N1" } }],
    [201, { Name: { value: "Instalacja CWU" } }]
  ]);
  const fakeApi = {
    GetLineIDsWithType: (modelId, type) => {
      const ids = type === IFCRELASSIGNSTOGROUP ? [100, 101] : [];
      return { size: () => ids.length, get: (i) => ids[i] };
    },
    GetLineType: () => IFCDISTRIBUTIONSYSTEM,
    GetLine: (modelId, id) => lines.get(id)
  };

  it("buduje tekst wskazówki z nazw systemów przypisanych do elementu", () => {
    const hints = buildElementSystemHints(fakeApi, 0);
    expect(hints.get(1)).toContain("wentylacja nawiewna n1");
    expect(hints.get(2)).toContain("wentylacja nawiewna n1");
    expect(hints.get(2)).toContain("instalacja cwu");
    expect(hints.has(3)).toBe(false);
  });

  it("wskazówka systemu rozstrzyga branżę elementu typu ogólnego", () => {
    const hints = buildElementSystemHints(fakeApi, 0);
    expect(resolveDiscipline({ typeId: IFCFLOWSEGMENT, systemHint: hints.get(1) })).toBe(DISCIPLINES.HVAC);
  });
});

describe("createLayerManager", () => {
  const model = () =>
    buildModel([
      { min: [0, 0, 0], max: [1, 1, 1], discipline: "Konstrukcja", typeName: "IFCCOLUMN", sourceFile: "a.ifc" },
      { min: [2, 0, 0], max: [3, 1, 1], discipline: "Konstrukcja", typeName: "IFCWALL", sourceFile: "a.ifc" },
      { min: [4, 0, 0], max: [5, 1, 1], discipline: "WodKan", typeName: "IFCPIPESEGMENT", sourceFile: "b.ifc" }
    ]);
  const layerNames = (entities) => entities.map((entity) => entity.layerName);

  it("warstwy domyślne powstają tylko dla branż obecnych w modelu", () => {
    const manager = createLayerManager();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 2, WodKan: 1, HVAC: 0 });
    expect(manager.getLayerNames()).toEqual(["Konstrukcja", "WodKan"]);
  });

  it("każda encja trafia do dokładnie jednej warstwy", () => {
    const manager = createLayerManager();
    const { group, entities } = model();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 2, WodKan: 1 });
    manager.assignMeshes(group);
    expect(layerNames(entities)).toEqual(["Konstrukcja", "Konstrukcja", "WodKan"]);
  });

  it("warstwa własna ma pierwszeństwo przed domyślną, a późniejsza przed wcześniejszą", () => {
    const manager = createLayerManager();
    const { group, entities } = model();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 2, WodKan: 1 });
    manager.addCustomLayer({ name: "Plik A", bindType: "file", bindValue: "a.ifc" });
    manager.assignMeshes(group);
    expect(layerNames(entities)).toEqual(["Plik A", "Plik A", "WodKan"]);

    manager.addCustomLayer({ name: "Slupy", bindType: "entity", bindValue: "IFCCOLUMN" });
    manager.assignMeshes(group);
    expect(layerNames(entities)).toEqual(["Slupy", "Plik A", "WodKan"]);
  });

  it("usunięcie warstwy własnej przywraca elementy poprzedniej warstwie", () => {
    const manager = createLayerManager();
    const { group, entities } = model();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 2, WodKan: 1 });
    const custom = manager.addCustomLayer({ name: "Slupy", bindType: "entity", bindValue: "IFCCOLUMN" });
    manager.assignMeshes(group);
    manager.removeLayer(custom.id);
    manager.assignMeshes(group);
    expect(layerNames(entities)).toEqual(["Konstrukcja", "Konstrukcja", "WodKan"]);
  });

  it("warstwy domyślnej nie można usunąć", () => {
    const manager = createLayerManager();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 2 });
    expect(() => manager.removeLayer(manager.getLayers()[0].id)).toThrow();
  });

  it("nazwy warstw własnych są unikalne", () => {
    const manager = createLayerManager();
    manager.addCustomLayer({ name: "X", bindType: "file", bindValue: "a.ifc" });
    manager.addCustomLayer({ name: "X", bindType: "file", bindValue: "b.ifc" });
    expect(manager.getLayerNames()).toEqual(["X", "X (2)"]);
  });

  it("odrzuca niepoprawne powiązanie", () => {
    const manager = createLayerManager();
    expect(() => manager.addCustomLayer({ name: "X", bindType: "discipline", bindValue: "HVAC" })).toThrow();
    expect(() => manager.addCustomLayer({ name: "X", bindType: "file", bindValue: "" })).toThrow();
  });

  it("przezroczystość jest ograniczana do zakresu 0–1", () => {
    const manager = createLayerManager();
    manager.syncDefaultLayersFromCounts({ Konstrukcja: 1 });
    const { id } = manager.getLayers()[0];
    manager.setLayerOpacity(id, 3);
    expect(manager.getLayerById(id).opacity).toBe(1);
    manager.setLayerOpacity(id, -1);
    expect(manager.getLayerById(id).opacity).toBe(0);
  });
});
