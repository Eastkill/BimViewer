import { DEFAULT_OUTPUT } from "./constants.js";

export const createUI = () => {
  const fileInput = document.getElementById("ifcFile");
  const loadButton = document.getElementById("loadButton");
  const loadSampleButton = document.getElementById("loadSampleButton");
  const loadRealisticSampleButton = document.getElementById("loadRealisticSampleButton");
  const output = document.getElementById("output");
  const canvas = document.getElementById("viewerCanvas");
  const layerControls = document.getElementById("layerControls");
  const collisionLayerA = document.getElementById("collisionLayerA");
  const collisionLayerB = document.getElementById("collisionLayerB");
  const detectCollisionsButton = document.getElementById("detectCollisionsButton");
  const collisionIsolationToggle = document.getElementById("collisionIsolationToggle");
  const collisionOutput = document.getElementById("collisionOutput");

  let baseModelInfo = DEFAULT_OUTPUT;

  const writeOutput = (text) => {
    output.textContent = text;
  };

  const setBaseModelInfo = (text) => {
    baseModelInfo = text;
  };

  const showModelInfo = (selectionText = null) => {
    writeOutput(selectionText ? `${baseModelInfo}\n\n${selectionText}` : baseModelInfo);
  };

  const setLoading = (isLoading) => {
    loadButton.disabled = isLoading;
    loadSampleButton.disabled = isLoading;
    loadRealisticSampleButton.disabled = isLoading;
    detectCollisionsButton.disabled = isLoading;
    collisionIsolationToggle.disabled = isLoading;
    if (isLoading) {
      writeOutput("Wczytywanie IFC i budowanie sceny WebGPU...");
    }
  };

  const isCollisionIsolationEnabled = () => collisionIsolationToggle.checked;

  const setCollisionIsolationEnabled = (enabled) => {
    collisionIsolationToggle.checked = Boolean(enabled);
  };

  const onCollisionIsolationChange = (handler) => {
    collisionIsolationToggle.addEventListener("change", () => handler(collisionIsolationToggle.checked));
  };

  const setCollisionOutput = (text) => {
    collisionOutput.textContent = text;
  };

  const renderCollisionResults = (result, onPairClick) => {
    collisionOutput.innerHTML = "";

    const summary = document.createElement("p");
    summary.className = "collision-summary";

    if (!result || result.collisionsCount === 0) {
      summary.textContent = [
        `Warstwa A: ${result?.layerA ?? "-"}`,
        `Warstwa B: ${result?.layerB ?? "-"}`,
        `Sprawdzone obiekty: ${result?.testedA ?? 0} x ${result?.testedB ?? 0}`,
        "Kolizje: 0"
      ].join("\n");
      collisionOutput.append(summary);
      return;
    }

    summary.textContent = [
      `Warstwa A: ${result.layerA}`,
      `Warstwa B: ${result.layerB}`,
      `Sprawdzone obiekty: ${result.testedA} x ${result.testedB}`,
      `Kolizje: ${result.collisionsCount}`,
      "Kliknij pare, aby podswietlic obiekty na czerwono.",
      "Wlacz \"Tryb izolacji kolizji\", aby przygasic reszte modelu."
    ].join("\n");
    collisionOutput.append(summary);

    const list = document.createElement("ul");
    list.className = "collision-list";

    result.samplePairs.forEach((pair, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "collision-item";
      button.textContent = `${index + 1}. ${pair.leftExpressId} (${pair.leftDiscipline}) <-> ${pair.rightExpressId} (${pair.rightDiscipline})`;
      button.addEventListener("click", () => {
        list.querySelectorAll(".collision-item.active").forEach((node) => node.classList.remove("active"));
        button.classList.add("active");
        onPairClick(pair);
      });
      item.append(button);
      list.append(item);
    });

    collisionOutput.append(list);
  };

  const renderLayerControls = (disciplineCounts, handlers = {}) => {
    const onLayerToggle = handlers.onLayerToggle ?? (() => {});
    const onLayerOpacityChange = handlers.onLayerOpacityChange ?? (() => {});

    layerControls.innerHTML = "";
    for (const [discipline, count] of Object.entries(disciplineCounts)) {
      const row = document.createElement("div");
      row.className = "layer-row";

      const top = document.createElement("label");
      top.className = "layer-row-main";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.addEventListener("change", () => onLayerToggle(discipline, checkbox.checked));

      const name = document.createElement("span");
      name.textContent = discipline;

      const countNode = document.createElement("span");
      countNode.className = "layer-count";
      countNode.textContent = `${count}`;

      top.append(checkbox, name, countNode);

      const opacityRow = document.createElement("div");
      opacityRow.className = "layer-opacity-row";

      const opacityLabel = document.createElement("span");
      opacityLabel.className = "layer-opacity-label";
      opacityLabel.textContent = "Przezroczystosc";

      const opacityValue = document.createElement("span");
      opacityValue.className = "layer-opacity-value";
      opacityValue.textContent = "0%";

      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.min = "0";
      opacitySlider.max = "100";
      opacitySlider.step = "1";
      // Slider = transparency percent (0 opaque, 100 fully transparent).
      opacitySlider.value = "0";
      opacitySlider.addEventListener("input", () => {
        const transparencyPercent = Number(opacitySlider.value);
        opacityValue.textContent = `${transparencyPercent}%`;
        const opacityPercent = 100 - transparencyPercent;
        onLayerOpacityChange(discipline, opacityPercent);
      });

      opacityRow.append(opacityLabel, opacitySlider, opacityValue);
      row.append(top, opacityRow);
      layerControls.append(row);
    }
  };

  const setCollisionLayerOptions = (layers) => {
    collisionLayerA.innerHTML = "";
    collisionLayerB.innerHTML = "";
    for (const layer of layers) {
      const optionA = document.createElement("option");
      optionA.value = layer;
      optionA.textContent = layer;
      collisionLayerA.append(optionA);

      const optionB = document.createElement("option");
      optionB.value = layer;
      optionB.textContent = layer;
      collisionLayerB.append(optionB);
    }
    if (layers.length > 1) collisionLayerB.value = layers[1];
  };

  const getSelectedCollisionLayers = () => ({
    layerA: collisionLayerA.value,
    layerB: collisionLayerB.value
  });

  showModelInfo();

  return {
    fileInput,
    loadButton,
    loadSampleButton,
    loadRealisticSampleButton,
    canvas,
    writeOutput,
    showModelInfo,
    setBaseModelInfo,
    setLoading,
    renderLayerControls,
    setCollisionLayerOptions,
    getSelectedCollisionLayers,
    detectCollisionsButton,
    setCollisionOutput,
    renderCollisionResults,
    isCollisionIsolationEnabled,
    setCollisionIsolationEnabled,
    onCollisionIsolationChange
  };
};
