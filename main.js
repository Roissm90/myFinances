const importButton = document.getElementById("importButton");
const excelInput = document.getElementById("excelInput");
const monthSelect = document.getElementById("monthSelect");
const uploadsList = document.getElementById("uploadsList");
const downloadSummary = document.getElementById("downloadSummary");
const yearList = document.getElementById("yearList");
const addYearButton = document.getElementById("addYearButton");
const currentYearLabel = document.getElementById("currentYearLabel");

let selectedYear = new Date().getFullYear();

const HEADER_KEYS = [
  "fecha operacion",
  "fecha valor",
  "concepto",
  "importe",
  "saldo",
];


const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");


const extractMovementsFromRows = (rows) => {
  let headerRowIndex = -1;
  let headerPositions = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i].map((cell) => normalizeKey(cell));
    const positions = HEADER_KEYS.map((key) => row.indexOf(key));
    const hasAllHeaders = positions.every((pos) => pos >= 0);

    if (hasAllHeaders) {
      headerRowIndex = i;
      headerPositions = positions;
      break;
    }
  }

  if (headerRowIndex < 0 || !headerPositions) {
    return [];
  }

  const lastIndex = Math.max(...headerPositions);
  const movements = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length <= lastIndex) {
      continue;
    }

    const values = headerPositions.map((pos) => normalizeText(row[pos]));
    const isEmpty = values.every((value) => value === "");
    if (isEmpty) {
      continue;
    }

    movements.push({
      fechaOperacion: values[0],
      fechaValor: values[1],
      concepto: values[2],
      importe: values[3],
      saldo: values[4],
    });
  }

  return movements;
};

const extractMovementsFromHtml = (htmlText) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const rows = Array.from(doc.querySelectorAll("table tr")).map((row) =>
    Array.from(row.querySelectorAll("td, th")).map((cell) =>
      normalizeText(cell.textContent)
    )
  );

  return extractMovementsFromRows(rows);
};

const fetchUploads = async () => {
  try {
    const response = await fetch(`/uploads?year=${selectedYear}`);
    if (!response.ok) {
      throw new Error("Error al listar uploads");
    }
    const data = await response.json();
    window.uploadsUI.renderUploadsList(uploadsList, data.files || []);
    updateDownloadState(data.files);
    if (window.dashboardUI?.updateDashboard) {
      window.dashboardUI.updateDashboard(data.files || []);
    }
  } catch (error) {
    console.error(error);
  }
};

const updateYearLabel = () => {
  if (currentYearLabel) {
    currentYearLabel.textContent = `Ano actual: ${selectedYear}`;
  }
};

const renderYearList = (years) => {
  if (!yearList) {
    return;
  }
  yearList.innerHTML = "";
  years.forEach((year) => {
    const li = document.createElement("li");
    li.className = "year-item";
    if (year === selectedYear) {
      li.classList.add("is-active");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "year-button";
    button.dataset.year = year;
    button.textContent = year;
    li.appendChild(button);
    yearList.appendChild(li);
  });
};

const fetchYears = async () => {
  try {
    const response = await fetch("/years");
    if (!response.ok) {
      throw new Error("Error al listar anos");
    }
    const data = await response.json();
    const years = Array.isArray(data.years) ? data.years : [];
    if (years.length) {
      if (!years.includes(selectedYear)) {
        const currentYear = new Date().getFullYear();
        selectedYear = years.includes(currentYear) ? currentYear : years[0];
      }
    }
    renderYearList(years);
    updateYearLabel();
    await fetchUploads();
  } catch (error) {
    console.error(error);
  }
};

const setSelectedYear = async (yearValue) => {
  const year = Number(yearValue);
  if (!Number.isInteger(year)) {
    return;
  }
  selectedYear = year;
  updateYearLabel();
  if (yearList) {
    yearList.querySelectorAll(".year-item").forEach((item) => {
      const button = item.querySelector(".year-button");
      item.classList.toggle("is-active", Number(button?.dataset.year) === year);
    });
  }
  await fetchUploads();
};

const updateDownloadState = (filesOrCount) => {
  if (!downloadSummary) {
    return;
  }

  const count = Array.isArray(filesOrCount) ? filesOrCount.length : filesOrCount;
  downloadSummary.disabled = !count;
};

const updateImportState = () => {
  importButton.disabled = !monthSelect.value;
};

importButton.addEventListener("click", () => {
  if (!monthSelect.value) {
    console.warn("Selecciona un mes antes de subir el Excel.");
    return;
  }
  excelInput.value = "";
  excelInput.click();
});

monthSelect.addEventListener("change", updateImportState);

if (yearList) {
  yearList.addEventListener("click", (event) => {
    const button = event.target.closest(".year-button");
    if (!button) {
      return;
    }
    setSelectedYear(button.dataset.year);
  });
}

if (addYearButton) {
  addYearButton.addEventListener("click", async () => {
    const defaultYear = new Date().getFullYear() + 1;
    const input = window.prompt("Ano nuevo", String(defaultYear));
    if (!input) {
      return;
    }
    const year = Number(input);
    if (!Number.isInteger(year)) {
      console.warn("Ano invalido");
      return;
    }
    try {
      const response = await fetch("/years", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ year }),
      });
      if (!response.ok) {
        throw new Error("No se pudo crear el ano");
      }
      await fetchYears();
      await setSelectedYear(year);
    } catch (error) {
      console.error(error);
    }
  });
}

if (downloadSummary) {
  downloadSummary.addEventListener("click", async () => {
    try {
      const response = await fetch(`/export-summary?year=${selectedYear}`);
      if (!response.ok) {
        throw new Error("Error al generar el Excel");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "saldos-finales.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  });
}

excelInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  if (!monthSelect.value) {
    console.warn("Selecciona un mes antes de subir el Excel.");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    const bytes = new Uint8Array(arrayBuffer);
    const textPreview = new TextDecoder("iso-8859-1").decode(bytes);

    let movements = [];

    if (textPreview.includes("<table") && textPreview.includes("<tr")) {
      movements = extractMovementsFromHtml(textPreview);
    } else {
      const workbook = XLSX.read(bytes, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      movements = extractMovementsFromRows(rows);
    }

    if (movements.length === 0) {
      console.warn(
        "No se encontraron movimientos. Revisa que el archivo tenga la tabla correcta."
      );
      return;
    }

    console.log("Movimientos:", movements);

    try {
      const response = await fetch("/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: movements,
          month: monthSelect.value,
          year: selectedYear,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al subir el JSON");
      }

      const result = await response.json();
      console.log("Archivo guardado:", result);
      await fetchUploads();
    } catch (error) {
      console.error(error);
      console.warn(
        "No se pudo guardar el JSON. Revisa la consola para mas detalles."
      );
    } finally {
      excelInput.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
});

fetchYears();
updateImportState();
window.uploadsUI.setupUploadsList(uploadsList);
updateDownloadState(0);
window.updateDownloadState = updateDownloadState;
