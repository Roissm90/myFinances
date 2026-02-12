const getMonthKeyFromFileName = (fileName) =>
  String(fileName ?? "")
    .replace(/^movimientos-\d{4}-/, "")
    .replace(/^movimientos-/, "")
    .replace(/\.json$/i, "")
    .trim();

const formatFileName = (fileName) => {
  const baseName = getMonthKeyFromFileName(fileName)
    .replace(/[_-]+/g, " ")
    .trim();

  const normalized = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const deleteModal = document.getElementById("deleteModal");
const confirmDeleteButton = document.getElementById("confirmDelete");
const cancelDeleteButton = document.getElementById("cancelDelete");
let pendingDeleteFile = null;
const tooltipMediaQuery = window.matchMedia("(min-width: 641px)");
let tooltipEl = null;

const ensureTooltip = () => {
  if (tooltipEl) {
    return tooltipEl;
  }
  tooltipEl = document.createElement("div");
  tooltipEl.className = "concept-tooltip";
  document.body.appendChild(tooltipEl);
  return tooltipEl;
};

const showConceptTooltip = (target) => {
  if (!tooltipMediaQuery.matches) {
    return;
  }
  const text = target?.textContent?.trim();
  if (!text) {
    return;
  }

  const tooltip = ensureTooltip();
  tooltip.textContent = text;
  tooltip.classList.add("is-visible");

  const rect = target.getBoundingClientRect();
  const offsetX = 8;
  const offsetY = 10;
  const left = rect.left + window.scrollX + offsetX;
  const top = rect.bottom + window.scrollY + offsetY;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
};

const hideConceptTooltip = () => {
  if (!tooltipEl) {
    return;
  }
  tooltipEl.classList.remove("is-visible");
};

const findMovementConcept = (eventTarget) => {
  if (!(eventTarget instanceof Element)) {
    return null;
  }
  return eventTarget.closest(".movement-concept");
};

document.addEventListener(
  "mouseenter",
  (event) => {
    const target = findMovementConcept(event.target);
    if (target) {
      showConceptTooltip(target);
    }
  },
  true
);

document.addEventListener(
  "mouseleave",
  (event) => {
    const target = findMovementConcept(event.target);
    if (target) {
      hideConceptTooltip();
    }
  },
  true
);

const createMovementRow = (movement) => {
  const row = document.createElement("div");
  row.className = "movement-row";

  const concept = document.createElement("div");
  concept.className = "movement-concept";
  concept.textContent = movement.concepto || "";

  const fechaValor = document.createElement("div");
  fechaValor.className = "movement-cell";
  fechaValor.textContent = formatDateValue(movement.fechaValor);

  const importe = document.createElement("div");
  const importeText = movement.importe || "";
  const normalizedAmount = String(importeText)
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const amountValue = Number(normalizedAmount);
  let amountClass = "";

  if (!Number.isNaN(amountValue)) {
    amountClass = amountValue < 0 ? "is-negative" : "is-positive";
  }

  importe.className = `movement-cell movement-amount ${amountClass}`.trim();
  importe.textContent = importeText;

  const saldo = document.createElement("div");
  saldo.className = "movement-cell";
  saldo.textContent = movement.saldo || "";

  row.appendChild(concept);
  row.appendChild(fechaValor);
  row.appendChild(importe);
  row.appendChild(saldo);
  return row;
};

const formatDateValue = (value) => {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  const parts = text.includes("/") ? text.split("/") : text.split("-");
  if (parts.length >= 2) {
    const day = parts[0].padStart(2, "0");
    const month = parts[1].padStart(2, "0");
    return `${day}/${month}`;
  }

  return text;
};

const parseAmount = (value) => {
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const numberValue = Number(normalized);
  return Number.isNaN(numberValue) ? null : numberValue;
};

const formatAmount = (value) =>
  typeof value === "number"
    ? value.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "";

const createSummaryRow = (initialBalance, finalBalance) => {
  const row = document.createElement("div");
  row.className = "movement-row movement-summary";

  const concept = document.createElement("div");
  concept.className = "movement-concept";
  concept.textContent = "Saldo";

  const initialCell = document.createElement("div");
  initialCell.className = "movement-cell summary-initial";
  initialCell.textContent = `Inicial: ${formatAmount(initialBalance)}`;

  const spacer = document.createElement("div");
  spacer.className = "movement-cell summary-spacer";
  spacer.textContent = "";

  const finalCell = document.createElement("div");
  finalCell.className = "movement-cell summary-final";
  finalCell.textContent = `Final: ${formatAmount(finalBalance)}`;

  row.appendChild(concept);
  row.appendChild(initialCell);
  row.appendChild(spacer);
  row.appendChild(finalCell);
  return row;
};

const renderMovementsPanel = (panel, movements) => {
  panel.innerHTML = "";

  if (!movements.length) {
    const empty = document.createElement("div");
    empty.className = "movements-empty";
    empty.textContent = "No hay movimientos";
    panel.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "movements-list";
  movements.forEach((movement) => {
    list.appendChild(createMovementRow(movement));
  });
  const newestMovement = movements[0];
  const oldestMovement = movements[movements.length - 1];
  const oldestSaldo = parseAmount(oldestMovement?.saldo);
  const oldestImporte = parseAmount(oldestMovement?.importe);
  const newestSaldo = parseAmount(newestMovement?.saldo);

  if (oldestSaldo !== null && oldestImporte !== null && newestSaldo !== null) {
    const initialBalance = oldestSaldo - oldestImporte;
    list.appendChild(createSummaryRow(initialBalance, newestSaldo));
  }
  panel.appendChild(list);
};

const fetchMovements = async (fileName) => {
  const response = await fetch(`/uploads/${encodeURIComponent(fileName)}`);
  if (!response.ok) {
    throw new Error("Error al cargar movimientos");
  }
  return response.json();
};

const toggleMovements = async (button, fileName) => {
  const li = button.closest("li");
  if (!li) {
    return;
  }

  if (!window.jQuery) {
    console.warn("jQuery no esta disponible.");
    return;
  }

  let panel = li.querySelector(".movements-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "movements-panel";
    panel.textContent = "Cargando...";
    panel.style.display = "none";
    li.appendChild(panel);
  }

  const $panel = window.jQuery(panel);

  if ($panel.is(":visible")) {
    $panel.slideUp(200);
    button.setAttribute("aria-expanded", "false");
    return;
  }

  if (!panel.dataset.loaded) {
    try {
      const data = await fetchMovements(fileName);
      renderMovementsPanel(panel, Array.isArray(data) ? data : []);
      panel.dataset.loaded = "true";
    } catch (error) {
      console.error(error);
      panel.textContent = "No se pudieron cargar los movimientos";
      panel.style.display = "block";
      return;
    }
  }

  $panel.stop(true, true).hide().slideDown(200);
  button.setAttribute("aria-expanded", "true");
};

const renderUploadsList = (listEl, files) => {
  listEl.innerHTML = "";

  if (!files.length) {
    const li = document.createElement("li");
    li.className = "uploads-empty";
    li.textContent = "Aun no hay archivos";
    listEl.appendChild(li);
    return;
  }

  const MONTH_ORDER = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];

  const getMonthIndex = (fileName) => {
    const baseName = getMonthKeyFromFileName(fileName)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const month = baseName.split(/\s|_/)[0];
    const index = MONTH_ORDER.indexOf(month);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const sortedFiles = [...files].sort((a, b) => {
    const indexA = getMonthIndex(a);
    const indexB = getMonthIndex(b);
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    return a.localeCompare(b);
  });

  sortedFiles.forEach((file) => {
    const li = document.createElement("li");
    li.className = "uploads-item";
    li.dataset.file = file;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "upload-button";
    button.dataset.file = file;
    button.setAttribute("aria-expanded", "false");

    const icon = document.createElement("span");
    icon.className = "doc-icon";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "upload-label";
    label.textContent = formatFileName(file);

    button.appendChild(icon);
    button.appendChild(label);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.setAttribute("aria-label", "Borrar archivo");

    const trashIcon = document.createElement("span");
    trashIcon.className = "trash-icon";
    trashIcon.setAttribute("aria-hidden", "true");
    deleteButton.appendChild(trashIcon);

    li.appendChild(button);
    li.appendChild(deleteButton);
    listEl.appendChild(li);
  });
};

const updateEmptyState = (listEl) => {
  if (listEl.children.length === 0) {
    const li = document.createElement("li");
    li.className = "uploads-empty";
    li.textContent = "Aun no hay archivos";
    listEl.appendChild(li);
  }
};

const getCurrentFiles = (listEl) =>
  Array.from(listEl.querySelectorAll(".uploads-item")).map(
    (item) => item.dataset.file
  );

const deleteUpload = async (fileName) => {
  if (!fileName) {
    throw new Error("Archivo no especificado");
  }
  const response = await fetch(`/uploads/${encodeURIComponent(fileName)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("No se pudo borrar el archivo");
  }
};

const openDeleteModal = (fileName) => {
  if (!deleteModal) {
    return;
  }
  pendingDeleteFile = fileName;
  deleteModal.classList.add("is-open");
  deleteModal.setAttribute("aria-hidden", "false");
};

const closeDeleteModal = () => {
  if (!deleteModal) {
    return;
  }
  pendingDeleteFile = null;
  deleteModal.classList.remove("is-open");
  deleteModal.setAttribute("aria-hidden", "true");
};

const setupUploadsList = (listEl) => {
  listEl.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".delete-button");
    if (deleteButton) {
      const file = deleteButton.closest("li")?.dataset.file;
      if (!file) {
        return;
      }
      openDeleteModal(file);
      return;
    }

    const button = event.target.closest(".upload-button");
    if (!button) {
      return;
    }
    toggleMovements(button, button.dataset.file);
  });
};

if (deleteModal) {
  deleteModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close='true']")) {
      closeDeleteModal();
    }
  });
}

if (cancelDeleteButton) {
  cancelDeleteButton.addEventListener("click", () => {
    closeDeleteModal();
  });
}

if (confirmDeleteButton) {
  confirmDeleteButton.addEventListener("click", () => {
    if (!pendingDeleteFile) {
      closeDeleteModal();
      return;
    }

    deleteUpload(pendingDeleteFile)
      .then(() => {
        const item = document.querySelector(
          `.uploads-item[data-file='${pendingDeleteFile}']`
        );
        if (item) {
          item.remove();
        }
        updateEmptyState(uploadsList);
        if (window.updateDownloadState) {
          const remaining = uploadsList.querySelectorAll(".uploads-item").length;
          window.updateDownloadState(remaining);
        }
        if (window.dashboardUI?.updateDashboard) {
          window.dashboardUI.updateDashboard(getCurrentFiles(uploadsList));
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        closeDeleteModal();
      });
  });
}

window.uploadsUI = {
  renderUploadsList,
  setupUploadsList,
};
