import { DEFAULT_OUTPUT } from "./constants.js";
import { formatVolume } from "./material-takeoff.js";

export const createUI = () => {
  const fileInput = document.getElementById("ifcFile");
  const loadButton = document.getElementById("loadButton");
  const loadSampleButton = document.getElementById("loadSampleButton");
  const loadRealisticSampleButton = document.getElementById("loadRealisticSampleButton");
  const loadBothSamplesButton = document.getElementById("loadBothSamplesButton");
  const output = document.getElementById("output");
  const canvas = document.getElementById("viewerCanvas");
  const layerControls = document.getElementById("layerControls");
  const fileAlignControls = document.getElementById("fileAlignControls");
  const collisionLayerA = document.getElementById("collisionLayerA");
  const collisionLayerB = document.getElementById("collisionLayerB");
  const detectCollisionsButton = document.getElementById("detectCollisionsButton");
  const collisionIsolationToggle = document.getElementById("collisionIsolationToggle");
  const collisionOutput = document.getElementById("collisionOutput");
  const tabViewerButton = document.getElementById("tabViewerButton");
  const tabReportButton = document.getElementById("tabReportButton");
  const viewerTabPanel = document.getElementById("viewerTabPanel");
  const reportTabPanel = document.getElementById("reportTabPanel");
  const viewerSidebarPanels = document.getElementById("viewerSidebarPanels");
  const reportSidebarPanels = document.getElementById("reportSidebarPanels");
  const materialReport = document.getElementById("materialReport");
  const refreshReportButton = document.getElementById("refreshReportButton");

  let baseModelInfo = DEFAULT_OUTPUT;
  let activeTab = "viewer";
  let onTabChangeHandler = null;
  let onRefreshReportHandler = null;

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
    if (refreshReportButton) refreshReportButton.disabled = isLoading;
    if (isLoading) {
      writeOutput("Wczytywanie IFC i budowanie sceny WebGPU...");
    }
  };

  const setActiveTab = (tabName) => {
    activeTab = tabName === "report" ? "report" : "viewer";
    const viewerActive = activeTab === "viewer";

    tabViewerButton?.classList.toggle("active", viewerActive);
    tabReportButton?.classList.toggle("active", !viewerActive);
    tabViewerButton?.setAttribute("aria-selected", String(viewerActive));
    tabReportButton?.setAttribute("aria-selected", String(!viewerActive));

    if (viewerTabPanel) {
      viewerTabPanel.classList.toggle("active", viewerActive);
      viewerTabPanel.hidden = !viewerActive;
    }
    if (reportTabPanel) {
      reportTabPanel.classList.toggle("active", !viewerActive);
      reportTabPanel.hidden = viewerActive;
    }

    viewerSidebarPanels?.classList.toggle("is-hidden", !viewerActive);
    reportSidebarPanels?.classList.toggle("is-hidden", viewerActive);

    onTabChangeHandler?.(activeTab);
  };

  const onTabChange = (handler) => {
    onTabChangeHandler = handler;
  };

  const onRefreshReport = (handler) => {
    onRefreshReportHandler = handler;
  };

  tabViewerButton?.addEventListener("click", () => setActiveTab("viewer"));
  tabReportButton?.addEventListener("click", () => setActiveTab("report"));
  refreshReportButton?.addEventListener("click", () => onRefreshReportHandler?.());

  const renderMaterialReport = (report, { loading = false, error = null } = {}) => {
    if (!materialReport) return;

    if (loading) {
      materialReport.innerHTML = `<p class="material-report-empty">Liczenie zużycia materiałów...</p>`;
      return;
    }

    if (error) {
      materialReport.innerHTML = `<p class="material-report-empty">Blad raportu: ${error}</p>`;
      return;
    }

    if (!report) {
      materialReport.innerHTML =
        `<p class="material-report-empty">Wczytaj model IFC, aby wygenerować raport materiałów.</p>`;
      return;
    }

    const rows = report.rows || [];
    const header = document.createElement("div");
    header.className = "material-report-header";
    header.innerHTML = `
      <h2>Zużycie materiałów — cały projekt</h2>
      <p class="material-report-meta">
        Elementy: ${report.elementCount ?? 0} |
        z materiałem IFC: ${report.elementsWithMaterials ?? 0} |
        objętość z Qto: ${report.elementsFromQto ?? 0} |
        z geometrii: ${report.elementsFromGeometry ?? 0}<br/>
        Suma objętości: <strong>${formatVolume(report.totalVolumeM3)} m³</strong>
        (estymacja — warstwy × powierzchnia / Qto / geometria)
      </p>
    `;

    if (!rows.length) {
      materialReport.innerHTML = "";
      materialReport.append(header);
      const empty = document.createElement("p");
      empty.className = "material-report-empty";
      empty.textContent =
        "Brak policzalnych ilości. Model może nie mieć materiałów ani quantities — spróbuj pliku z IfcMaterial / Qto.";
      materialReport.append(empty);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "material-report-table-wrap";
    const table = document.createElement("table");
    table.className = "material-report-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Materiał</th>
          <th>Objętość [m³]</th>
          <th>Udział</th>
          <th>Elementy (wpisy)</th>
          <th>Źródło / uwagi</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    const total = report.totalVolumeM3 || 0;

    for (const row of rows) {
      const tr = document.createElement("tr");
      const share = total > 0 ? `${((row.volumeM3 / total) * 100).toFixed(1)}%` : "—";
      const sourceText = [...(row.sources || []), ...(row.notes || [])].filter(Boolean).join(" · ") || "—";
      tr.innerHTML = `
        <td>${row.material}</td>
        <td class="num">${formatVolume(row.volumeM3)}</td>
        <td class="num">${share}</td>
        <td class="num">${row.elementCount}</td>
        <td>${sourceText}</td>
      `;
      tbody.append(tr);
    }

    table.append(tbody);
    wrap.append(table);
    materialReport.innerHTML = "";
    materialReport.append(header, wrap);
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

  const renderCollisionResults = (result, onPairClick, onPairDoubleClick) => {
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
      "Podwojne klikniecie przenosi kamere do kolizji.",
      "Wlacz \"Tryb izolacji kolizji\", aby przygasic reszte modelu."
    ].join("\n");
    collisionOutput.append(summary);

    const list = document.createElement("ul");
    list.className = "collision-list";

    const activatePair = (button, pair, handler) => {
      list.querySelectorAll(".collision-item.active").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      handler?.(pair);
    };

    result.samplePairs.forEach((pair, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "collision-item";
      button.title = "Kliknij: podswietl. Podwojne klikniecie: przenies kamere.";
      button.textContent = `${index + 1}. ${pair.leftExpressId} (${pair.leftDiscipline}) <-> ${pair.rightExpressId} (${pair.rightDiscipline})`;
      button.addEventListener("click", () => activatePair(button, pair, onPairClick));
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        activatePair(button, pair, onPairDoubleClick ?? onPairClick);
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

  const renderFileAlignControls = (fileEntries, selectedFileName, handlers = {}) => {
    const onSelectFile = handlers.onSelectFile ?? (() => {});
    const onTransformChange = handlers.onTransformChange ?? (() => {});
    const onReset = handlers.onReset ?? (() => {});
    const onToggleGizmo = handlers.onToggleGizmo ?? (() => {});
    const onModeChange = handlers.onModeChange ?? (() => {});
    const gizmoEnabled = Boolean(handlers.gizmoEnabled);
    const transformMode = handlers.transformMode === "rotate" ? "rotate" : "translate";

    fileAlignControls.innerHTML = "";

    if (!fileEntries?.length) {
      const empty = document.createElement("p");
      empty.className = "file-align-empty";
      empty.textContent = "Wczytaj jeden lub wiele plikow IFC, aby wyrównać modele.";
      fileAlignControls.append(empty);
      return;
    }

    const selected =
      fileEntries.find((entry) => entry.name === selectedFileName) ?? fileEntries[0];

    const fileSelect = document.createElement("select");
    fileSelect.className = "layer-input";
    for (const entry of fileEntries) {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = `${entry.name} (${entry.meshCount ?? 0})`;
      fileSelect.append(option);
    }
    fileSelect.value = selected.name;
    fileSelect.addEventListener("change", () => onSelectFile(fileSelect.value));
    fileAlignControls.append(fileSelect);

    const transform = selected.transform ?? { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

    const makeNumberField = (key, label, step) => {
      const field = document.createElement("div");
      field.className = "file-align-field";
      const fieldLabel = document.createElement("label");
      fieldLabel.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.step = String(step);
      input.value = String(transform[key] ?? 0);
      input.addEventListener("change", () => {
        onTransformChange(selected.name, { ...transform, [key]: Number(input.value) || 0 });
      });
      field.append(fieldLabel, input);
      return field;
    };

    const translateGrid = document.createElement("div");
    translateGrid.className = "file-align-grid";
    translateGrid.append(
      makeNumberField("x", "X [m]", 0.01),
      makeNumberField("y", "Y [m]", 0.01),
      makeNumberField("z", "Z [m]", 0.01)
    );

    const rotateGrid = document.createElement("div");
    rotateGrid.className = "file-align-grid";
    rotateGrid.append(
      makeNumberField("rx", "Rot X [°]", 0.1),
      makeNumberField("ry", "Rot Y [°]", 0.1),
      makeNumberField("rz", "Rot Z [°]", 0.1)
    );

    const gizmoLabel = document.createElement("label");
    gizmoLabel.className = "isolation-toggle";
    const gizmoToggle = document.createElement("input");
    gizmoToggle.type = "checkbox";
    gizmoToggle.checked = gizmoEnabled;
    gizmoToggle.addEventListener("change", () => onToggleGizmo(gizmoToggle.checked));
    const gizmoText = document.createElement("span");
    gizmoText.textContent = "Gizmo w widoku (przeciagnij osie)";
    gizmoLabel.append(gizmoToggle, gizmoText);

    const modeRow = document.createElement("div");
    modeRow.className = "file-align-mode";
    const translateBtn = document.createElement("button");
    translateBtn.type = "button";
    translateBtn.className = `secondary${transformMode === "translate" ? " active" : ""}`;
    translateBtn.textContent = "Przesun";
    translateBtn.addEventListener("click", () => onModeChange("translate"));
    const rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = `secondary${transformMode === "rotate" ? " active" : ""}`;
    rotateBtn.textContent = "Obroc";
    rotateBtn.addEventListener("click", () => onModeChange("rotate"));
    modeRow.append(translateBtn, rotateBtn);

    const actions = document.createElement("div");
    actions.className = "file-align-actions";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "secondary";
    resetBtn.textContent = "Reset wyrównania";
    resetBtn.addEventListener("click", () => onReset(selected.name));
    actions.append(resetBtn);

    const wrap = document.createElement("div");
    wrap.className = "file-align-row";
    wrap.append(translateGrid, rotateGrid, gizmoLabel, modeRow, actions);
    fileAlignControls.append(wrap);
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
    renderFileAlignControls,
    setCollisionLayerOptions,
    getSelectedCollisionLayers,
    detectCollisionsButton,
    setCollisionOutput,
    renderCollisionResults,
    isCollisionIsolationEnabled,
    setCollisionIsolationEnabled,
    onCollisionIsolationChange,
    setActiveTab,
    onTabChange,
    onRefreshReport,
    renderMaterialReport,
    getActiveTab: () => activeTab
  };
};
