import { syncEntityAppearance } from "./entities.js";

export const HIGHLIGHT_SELECTION = { r: 0.133, g: 0.827, b: 0.933 }; // #22d3ee
export const HIGHLIGHT_PROBLEM = { r: 0.937, g: 0.267, b: 0.267 }; // #ef4444

const restoreEntityHighlight = (entity) => {
  entity.highlightColor = null;
  syncEntityAppearance(entity);
};

const applyEntityHighlight = (entity, color) => {
  entity.highlightColor = color;
  syncEntityAppearance(entity);
};

export const createSelectionManager = ({ showModelInfo, resolveMaterials } = {}) => {
  let selectedEntities = [];
  let selectionToken = 0;

  const clearSelection = () => {
    selectionToken += 1;
    for (const entity of selectedEntities) {
      restoreEntityHighlight(entity);
    }
    selectedEntities = [];
  };

  const selectMeshes = (entities, { color = HIGHLIGHT_SELECTION, infoText = null } = {}) => {
    const unique = [...new Set(entities.filter(Boolean))];
    clearSelection();
    selectedEntities = unique;

    for (const entity of selectedEntities) {
      applyEntityHighlight(entity, color);
    }

    if (infoText) {
      showModelInfo?.(infoText);
    }
  };

  const formatMeshInfo = (label, entity, pairMeta = {}) => {
    const expressId = pairMeta.expressId ?? entity?.expressID ?? "brak";
    const geometryId = entity?.geometryExpressID ?? "brak";
    const typeId = entity?.typeId ?? "brak";
    const typeName = entity?.typeName ?? "brak";
    const discipline = pairMeta.discipline ?? entity?.discipline ?? "brak";
    const objectType = entity?.objectType ?? "brak";
    const name = entity?.name ?? "brak";
    const globalId = entity?.globalId ?? "brak";
    const sourceFile = entity?.sourceFile ?? "brak";
    const material = pairMeta.material ?? entity?.materialLabel ?? "…";
    return [
      `${label}:`,
      `Plik: ${sourceFile}`,
      `ExpressID: ${expressId}`,
      `GlobalId: ${globalId}`,
      `GeometryID: ${geometryId}`,
      `web-ifc typeId: ${typeId}`,
      `Entity: ${typeName}`,
      `Name: ${name}`,
      `ObjectType: ${objectType}`,
      `Material: ${material}`,
      `Branża: ${discipline}`,
      `Warstwa: ${entity?.layerName ?? "brak"}`
    ].join("\n");
  };

  const collisionHeader = (pairMeta) =>
    ["Kolizja (A – czerwony, B – pomarańczowy, żółta ramka – miejsce kolizji):", pairMeta.locationText]
      .filter(Boolean)
      .join("\n");

  const enrichEntityMaterial = async (entity, token) => {
    if (!entity || !resolveMaterials) return entity?.materialLabel ?? "brak";
    if (entity.materialLabel && entity.materialLabel !== "…") return entity.materialLabel;

    const label = await resolveMaterials(entity);
    if (token !== selectionToken) return label;
    entity.materialLabel = label || "brak";
    return entity.materialLabel;
  };

  const selectMesh = async (entity) => {
    const token = selectionToken + 1;
    selectMeshes([entity], {
      infoText: formatMeshInfo("Zaznaczenie", entity, { material: entity?.materialLabel ?? "…" })
    });

    const material = await enrichEntityMaterial(entity, token);
    if (token !== selectionToken) return;
    showModelInfo?.(formatMeshInfo("Zaznaczenie", entity, { material }));
  };

  const highlightCollisionPair = async (leftEntity, rightEntity, pairMeta = {}) => {
    const token = selectionToken + 1;
    selectMeshes([leftEntity, rightEntity], {
      color: HIGHLIGHT_PROBLEM,
      infoText: [
        collisionHeader(pairMeta),
        "",
        formatMeshInfo("A", leftEntity, {
          expressId: pairMeta.leftExpressId,
          discipline: pairMeta.leftDiscipline,
          material: leftEntity?.materialLabel ?? "…"
        }),
        "",
        formatMeshInfo("B", rightEntity, {
          expressId: pairMeta.rightExpressId,
          discipline: pairMeta.rightDiscipline,
          material: rightEntity?.materialLabel ?? "…"
        })
      ].join("\n")
    });

    const [leftMaterial, rightMaterial] = await Promise.all([
      enrichEntityMaterial(leftEntity, token),
      enrichEntityMaterial(rightEntity, token)
    ]);
    if (token !== selectionToken) return;

    showModelInfo?.(
      [
        collisionHeader(pairMeta),
        "",
        formatMeshInfo("A", leftEntity, {
          expressId: pairMeta.leftExpressId,
          discipline: pairMeta.leftDiscipline,
          material: leftMaterial
        }),
        "",
        formatMeshInfo("B", rightEntity, {
          expressId: pairMeta.rightExpressId,
          discipline: pairMeta.rightDiscipline,
          material: rightMaterial
        })
      ].join("\n")
    );
  };

  const highlightDuplicateGroup = async (group) => {
    const entities = [...new Set((group?.entities || []).filter(Boolean))];
    const kindLabel = group?.kind === "globalId" ? "Duplikat GlobalId" : "Duplikat geometryczny";
    const itemLines = (group?.items || []).map((item, index) => {
      const entity = item.entity;
      return `${index + 1}. ${entity?.name ?? "?"} | ExpressID ${entity?.expressID ?? "?"} | GlobalId ${entity?.globalId ?? "brak"} | ${entity?.sourceFile ?? "?"}`;
    });

    selectMeshes(entities, {
      color: HIGHLIGHT_PROBLEM,
      infoText: [
        `${kindLabel}: ${group?.label ?? ""}`,
        `Elementy w grupie: ${group?.items?.length ?? entities.length}`,
        "",
        ...itemLines
      ].join("\n")
    });
  };

  return {
    clearSelection,
    selectMesh,
    selectMeshes,
    highlightCollisionPair,
    highlightDuplicateGroup
  };
};
