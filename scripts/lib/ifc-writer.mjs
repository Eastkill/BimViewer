/**
 * Minimal IFC4 (STEP) writer used by the test-model generators.
 * Produces axis-aligned extruded boxes with deterministic GlobalIds, so every
 * generated model has analytically known volumes, areas and clashes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Deterministic PRNG (mulberry32) — stable GlobalIds across regenerations. */
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const GUID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

export const createIfcWriter = ({ seed, projectName, description = "" }) => {
  let nextId = 1;
  const lines = [];
  const rand = mulberry32(seed);

  const esc = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
  const num = (value) => {
    const text = String(Number(value.toFixed(6)));
    return text.includes(".") || text.includes("e") ? text : `${text}.`;
  };
  const emit = (entity) => {
    const expressId = nextId;
    nextId += 1;
    lines.push(`#${expressId}=${entity};`);
    return expressId;
  };
  const refs = (ids) => `(${ids.map((x) => `#${x}`).join(",")})`;

  const guid = () => {
    // IFC compressed GUID: first char encodes 2 bits → must be in 0–3.
    let out = GUID_ALPHABET[(rand() * 4) | 0];
    for (let i = 1; i < 22; i += 1) out += GUID_ALPHABET[(rand() * GUID_ALPHABET.length) | 0];
    return out;
  };

  const point = (x, y, z) => emit(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const direction = (x, y, z) => emit(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);

  // Shared directions / 2D placement keep big generated files small.
  const dirZ = direction(0, 0, 1);
  const dirX = direction(1, 0, 0);
  const origin3d = point(0, 0, 0);
  const worldAxes = emit(`IFCAXIS2PLACEMENT3D(#${origin3d},#${dirZ},#${dirX})`);
  const origin2d = emit("IFCCARTESIANPOINT((0.,0.))");
  const dir2d = emit("IFCDIRECTION((1.,0.))");
  const profilePlacement = emit(`IFCAXIS2PLACEMENT2D(#${origin2d},#${dir2d})`);

  const localPlacement = (relativeTo, [x, y, z]) => {
    const axes =
      x === 0 && y === 0 && z === 0
        ? worldAxes
        : emit(`IFCAXIS2PLACEMENT3D(#${point(x, y, z)},#${dirZ},#${dirX})`);
    return emit(`IFCLOCALPLACEMENT(${relativeTo == null ? "$" : `#${relativeTo}`},#${axes})`);
  };

  const person = emit("IFCPERSON($,'Koordynator',$,$,$,$,$,$)");
  const org = emit("IFCORGANIZATION($,'BimViewer Lab',$,$,$)");
  const personOrg = emit(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = emit(`IFCAPPLICATION(#${org},'1.0','BimViewer Test Generator','BimViewer')`);
  const ownerHistory = emit(`IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,1730000000)`);

  const context = emit(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${worldAxes},$)`);
  const bodyContext = emit(
    `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${context},$,.MODEL_VIEW.,$)`
  );
  const units = emit(
    `IFCUNITASSIGNMENT(${refs([
      emit("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
      emit("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
      emit("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
      emit("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")
    ])})`
  );

  const projectPlacement = localPlacement(null, [0, 0, 0]);
  const sitePlacement = localPlacement(projectPlacement, [0, 0, 0]);
  const buildingPlacement = localPlacement(sitePlacement, [0, 0, 0]);
  const project = emit(
    `IFCPROJECT('${guid()}',#${ownerHistory},'${esc(projectName)}','${esc(description)}',$,$,$,(#${context}),#${units})`
  );
  const site = emit(
    `IFCSITE('${guid()}',#${ownerHistory},'Dzialka',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`
  );
  const building = emit(
    `IFCBUILDING('${guid()}',#${ownerHistory},'${esc(projectName)}',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`
  );

  const relAggregates = (relating, related) =>
    emit(`IFCRELAGGREGATES('${guid()}',#${ownerHistory},$,$,#${relating},${refs(related)})`);
  relAggregates(project, [site]);
  relAggregates(site, [building]);

  const storeys = [];
  const addStorey = (name, elevation) => {
    const placement = localPlacement(buildingPlacement, [0, 0, elevation]);
    const storey = emit(
      `IFCBUILDINGSTOREY('${guid()}',#${ownerHistory},'${esc(name)}',$,$,#${placement},$,$,.ELEMENT.,${num(elevation)})`
    );
    const entry = { id: storey, placement, elements: [] };
    storeys.push(entry);
    return entry;
  };

  const styleCache = new Map();
  const surfaceStyle = ([r, g, b]) => {
    const key = `${r},${g},${b}`;
    if (!styleCache.has(key)) {
      const colour = emit(`IFCCOLOURRGB($,${num(r)},${num(g)},${num(b)})`);
      const rendering = emit(`IFCSURFACESTYLERENDERING(#${colour},0.,$,$,$,$,$,$,.FLAT.)`);
      styleCache.set(key, emit(`IFCSURFACESTYLE($,.BOTH.,(#${rendering}))`));
    }
    return styleCache.get(key);
  };

  const profileCache = new Map();
  const rectangleProfile = (xDim, yDim) => {
    const key = `${xDim}x${yDim}`;
    if (!profileCache.has(key)) {
      profileCache.set(
        key,
        emit(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilePlacement},${num(xDim)},${num(yDim)})`)
      );
    }
    return profileCache.get(key);
  };

  /**
   * Box product. `origin` is the centre of the bottom face (profile is centred on its
   * placement), `size` = [x, y] footprint, `height` = extrusion along +Z.
   * Extra attributes after Tag (e.g. PredefinedType) go into `extraAttributes`.
   */
  const addBox = (storey, { type, name, description = "", objectType = null, origin, size, height, color, extraAttributes = [] }) => {
    const placement = localPlacement(storey.placement, origin);
    const solid = emit(
      `IFCEXTRUDEDAREASOLID(#${rectangleProfile(size[0], size[1])},#${worldAxes},#${dirZ},${num(height)})`
    );
    emit(`IFCSTYLEDITEM(#${solid},(#${surfaceStyle(color)}),$)`);
    const rep = emit(`IFCSHAPEREPRESENTATION(#${bodyContext},'Body','SweptSolid',(#${solid}))`);
    const shape = emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    const attrs = [
      `'${guid()}'`,
      `#${ownerHistory}`,
      `'${esc(name)}'`,
      description ? `'${esc(description)}'` : "$",
      objectType ? `'${esc(objectType)}'` : "$",
      `#${placement}`,
      `#${shape}`,
      `'${esc(name)}'`,
      ...extraAttributes
    ];
    const product = emit(`${type}(${attrs.join(",")})`);
    storey.elements.push(product);
    return product;
  };

  /** quantities: { area: {Name: value}, volume: {Name: value} } */
  const addQuantities = (productId, qtoName, { area = {}, volume = {} }) => {
    const items = [
      ...Object.entries(area).map(([name, value]) =>
        emit(`IFCQUANTITYAREA('${esc(name)}',$,$,${num(value)},$)`)
      ),
      ...Object.entries(volume).map(([name, value]) =>
        emit(`IFCQUANTITYVOLUME('${esc(name)}',$,$,${num(value)},$)`)
      )
    ];
    if (!items.length) return;
    const qto = emit(`IFCELEMENTQUANTITY('${guid()}',#${ownerHistory},'${esc(qtoName)}',$,$,${refs(items)})`);
    emit(`IFCRELDEFINESBYPROPERTIES('${guid()}',#${ownerHistory},$,$,(#${productId}),#${qto})`);
  };

  const material = (name) => emit(`IFCMATERIAL('${esc(name)}',$,$)`);

  /** layers: [{ material: id, thickness }] */
  const materialLayerSetUsage = (name, layers) => {
    const layerIds = layers.map((layer) =>
      emit(`IFCMATERIALLAYER(#${layer.material},${num(layer.thickness)},$,$,$,$,$)`)
    );
    const set = emit(`IFCMATERIALLAYERSET(${refs(layerIds)},'${esc(name)}',$)`);
    return emit(`IFCMATERIALLAYERSETUSAGE(#${set},.AXIS2.,.POSITIVE.,0.,$)`);
  };

  /** constituents: [{ name, material: id }] */
  const materialConstituentSet = (name, constituents) => {
    const ids = constituents.map((item) =>
      emit(`IFCMATERIALCONSTITUENT('${esc(item.name)}',$,#${item.material},$,$)`)
    );
    return emit(`IFCMATERIALCONSTITUENTSET('${esc(name)}',$,${refs(ids)})`);
  };

  const associateMaterial = (productIds, materialDefinitionId) =>
    emit(
      `IFCRELASSOCIATESMATERIAL('${guid()}',#${ownerHistory},$,$,${refs(productIds)},#${materialDefinitionId})`
    );

  const distributionSystem = (name, productIds) => {
    const system = emit(`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHistory},'${esc(name)}',$,$,$,$)`);
    emit(`IFCRELASSIGNSTOGROUP('${guid()}',#${ownerHistory},$,$,${refs(productIds)},$,#${system})`);
    return system;
  };

  const write = (outPath) => {
    relAggregates(
      building,
      storeys.map((storey) => storey.id)
    );
    for (const storey of storeys) {
      if (!storey.elements.length) continue;
      emit(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${ownerHistory},$,$,${refs(storey.elements)},#${storey.id})`
      );
    }

    const fileName = outPath.split(/[\\/]/).pop();
    const content = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      `FILE_NAME('${esc(fileName)}','2026-03-26T15:00:00',('BimViewer'),('BimViewer Lab'),'BimViewer Test Generator','BimViewer','');`,
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      ...lines,
      "ENDSEC;",
      "END-ISO-10303-21;"
    ].join("\n");

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content, "utf8");
    return { entityCount: lines.length, bytes: Buffer.byteLength(content) };
  };

  return {
    addStorey,
    addBox,
    addQuantities,
    material,
    materialLayerSetUsage,
    materialConstituentSet,
    associateMaterial,
    distributionSystem,
    write
  };
};
