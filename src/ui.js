import { DEFAULT_OUTPUT } from "./constants.js";

export const createUI = () => {
  const fileInput = document.getElementById("ifcFile");
  const loadButton = document.getElementById("loadButton");
  const loadSampleButton = document.getElementById("loadSampleButton");
  const loadRealisticSampleButton = document.getElementById("loadRealisticSampleButton");
  const loadBothSamplesButton = document.getElementById("loadBothSamplesButton");
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
    if (loadBothSamplesButton) loadBothSamplesButton.disabled = isLoading;
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

  const renderLayerControls = (layers, countsById, bindingOptions, handlers = {}) => {
    const onLayerToggle = handlers.onLayerToggle ?? (() => {});
    const onLayerOpacityChange = handlers.onLayerOpacityChange ?? (() => {});
    const onAddCustomLayer = handlers.onAddCustomLayer ?? (() => {});
    const onRemoveLayer = handlers.onRemoveLayer ?? (() => {});
    const onResetDefaults = handlers.onResetDefaults ?? (() => {});

    layerControls.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "layer-toolbar";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "secondary";
    resetBtn.textContent = "Przywroc domyslne";
    resetBtn.addEventListener("click", () => onResetDefaults());
    toolbar.append(resetBtn);
    layerControls.append(toolbar);

    const form = document.createElement("div");
    form.className = "layer-create-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Nazwa custom warstwy";
    nameInput.className = "layer-input";

    const bindType = document.createElement("select");
    bindType.className = "layer-input";
    bindType.innerHTML = `
      <option value="file">Powiaz z plikiem</option>
      <option value="entity">Powiaz z entity</option>
    `;

    const bindValue = document.createElement("select");
    bindValue.className = "layer-input";

    const fillBindValues = () => {
      const values = bindType.value === "file" ? bindingOptions.files : bindingOptions.entities;
      bindValue.innerHTML = "";
      if (!values.length) {
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Brak opcji - wczytaj model";
        bindValue.append(empty);
        return;
      }
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        bindValue.append(option);
      }
    };
    bindType.addEventListener("change", fillBindValues);
    fillBindValues();

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Dodaj warstwe";
    addBtn.addEventListener("click", () => {
      onAddCustomLayer({
        name: nameInput.value,
        bindType: bindType.value,
        bindValue: bindValue.value
      });
      nameInput.value = "";
    });

    form.append(nameInput, bindType, bindValue, addBtn);
    layerControls.append(form);

    const hint = document.createElement("p");
    hint.className = "layer-hint";
    hint.textContent =
      "Domyslne warstwy = branze. Custom warstwa przejmuje elementy z wybranego pliku albo typu entity.";
    layerControls.append(hint);

    for (const layer of layers) {
      const row = document.createElement("div");
      row.className = `layer-row ${layer.kind === "custom" ? "layer-row-custom" : ""}`;

      const top = document.createElement("div");
      top.className = "layer-row-main";

      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "layer-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = layer.visible;
      checkbox.addEventListener("change", () => onLayerToggle(layer.id, checkbox.checked));
      const name = document.createElement("span");
      name.textContent = layer.name;
      checkboxLabel.append(checkbox, name);

      const badge = document.createElement("span");
      badge.className = "layer-badge";
      badge.textContent = layer.kind === "default" ? "domyslna" : "custom";

      const countNode = document.createElement("span");
      countNode.className = "layer-count";
      countNode.textContent = `${countsById[layer.id] ?? 0}`;

      top.append(checkboxLabel, badge, countNode);

      if (layer.kind === "custom") {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "secondary layer-remove";
        removeBtn.textContent = "Usun";
        removeBtn.addEventListener("click", () => onRemoveLayer(layer.id));
        top.append(removeBtn);
      }

      const meta = document.createElement("div");
      meta.className = "layer-meta";
      if (layer.binding?.type === "discipline") {
        meta.textContent = `Branza: ${layer.binding.value}`;
      } else if (layer.binding?.type === "file") {
        meta.textContent = `Plik: ${layer.binding.value}`;
      } else if (layer.binding?.type === "entity") {
        meta.textContent = `Entity: ${layer.binding.value}`;
      }

      const opacityRow = document.createElement("div");
      opacityRow.className = "layer-opacity-row";

      const opacityLabel = document.createElement("span");
      opacityLabel.className = "layer-opacity-label";
      opacityLabel.textContent = "Przezroczystosc";

      const opacityValue = document.createElement("span");
      opacityValue.className = "layer-opacity-value";
      const transparencyPercent = Math.round((1 - layer.opacity) * 100);
      opacityValue.textContent = `${transparencyPercent}%`;

      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.min = "0";
      opacitySlider.max = "100";
      opacitySlider.step = "1";
      opacitySlider.value = String(transparencyPercent);
      opacitySlider.addEventListener("input", () => {
        const value = Number(opacitySlider.value);
        opacityValue.textContent = `${value}%`;
        onLayerOpacityChange(layer.id, 100 - value);
      });

      opacityRow.append(opacityLabel, opacitySlider, opacityValue);
      row.append(top, meta, opacityRow);
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
    loadBothSamplesButton,
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
