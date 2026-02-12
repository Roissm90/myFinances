const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();
const port = 3000;
const uploadsDir = path.join(__dirname, "uploads");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

app.post("/upload", async (req, res) => {
  try {
    const { data, month } = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: "Formato invalido" });
    }

    if (typeof month !== "string" || month.trim() === "") {
      return res.status(400).json({ error: "Mes requerido" });
    }

    await fs.mkdir(uploadsDir, { recursive: true });
    const safeMonth = month
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "");
    const fileName = `movimientos-${safeMonth}.json`;
    const filePath = path.join(uploadsDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

    return res.json({ fileName, rows: data.length });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo guardar el archivo" });
  }
});

app.get("/uploads", async (_req, res) => {
  try {
    const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    return res.json({ files });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return res.json({ files: [] });
    }
    return res.status(500).json({ error: "No se pudo listar uploads" });
  }
});

app.get("/uploads/:fileName", async (req, res) => {
  try {
    const requested = path.basename(req.params.fileName || "");
    if (!requested.endsWith(".json")) {
      return res.status(400).json({ error: "Archivo invalido" });
    }

    const filePath = path.join(uploadsDir, requested);
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return res.json(data);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    return res.status(500).json({ error: "No se pudo leer el archivo" });
  }
});

app.delete("/uploads/:fileName", async (req, res) => {
  try {
    const requested = path.basename(req.params.fileName || "");
    if (!requested.endsWith(".json")) {
      return res.status(400).json({ error: "Archivo invalido" });
    }

    const filePath = path.join(uploadsDir, requested);
    await fs.unlink(filePath);
    return res.json({ deleted: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    return res.status(500).json({ error: "No se pudo borrar el archivo" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const parseAmount = (value) => {
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const numberValue = Number(normalized);
  return Number.isNaN(numberValue) ? null : numberValue;
};

const formatMonthLabel = (fileName) => {
  const baseName = String(fileName)
    .replace(/^movimientos-/, "")
    .replace(/\.json$/i, "")
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
  const baseName = String(fileName)
    .replace(/^movimientos-/, "")
    .replace(/\.json$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const month = baseName.split(/\s|_/)[0];
  const index = MONTH_ORDER.indexOf(month);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

app.get("/export-summary", async (_req, res) => {
  try {
    const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => {
        const indexA = getMonthIndex(a);
        const indexB = getMonthIndex(b);
        if (indexA !== indexB) {
          return indexA - indexB;
        }
        return a.localeCompare(b);
      });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Saldos");
    sheet.columns = [
      { header: "Mes", key: "mes", width: 18 },
      { header: "Saldo Inicial", key: "saldoInicial", width: 18 },
      { header: "Saldo Final", key: "saldoFinal", width: 18 },
      { header: "Diferencia", key: "diferencia", width: 18 },
    ];

    sheet.getRow(1).font = { bold: true };
    let totalDifference = 0;

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const content = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(content);
      if (!Array.isArray(data) || data.length === 0) {
        continue;
      }

      const newest = data[0];
      const oldest = data[data.length - 1];
      const saldoFinal = parseAmount(newest?.saldo);
      const oldestSaldo = parseAmount(oldest?.saldo);
      const oldestImporte = parseAmount(oldest?.importe);

      if (saldoFinal === null || oldestSaldo === null || oldestImporte === null) {
        continue;
      }

      const saldoInicial = oldestSaldo - oldestImporte;
      const diferencia = saldoFinal - saldoInicial;
      totalDifference += diferencia;

      const row = sheet.addRow({
        mes: formatMonthLabel(file),
        saldoInicial,
        saldoFinal,
        diferencia,
      });

      const diffCell = row.getCell("diferencia");
      diffCell.font = {
        color: { argb: diferencia < 0 ? "FFC62828" : "FF2E7D32" },
      };
    }

    sheet.getColumn("saldoInicial").numFmt = "#,##0.00";
    sheet.getColumn("saldoFinal").numFmt = "#,##0.00";
    sheet.getColumn("diferencia").numFmt = "#,##0.00";

    const totalRow = sheet.addRow({
      mes: "Saldo anual",
      diferencia: totalDifference,
    });
    totalRow.font = { bold: true };
    totalRow.getCell("diferencia").font = {
      bold: true,
      color: { argb: totalDifference < 0 ? "FFC62828" : "FF2E7D32" },
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=\"saldos-finales.xlsx\""
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    return res.status(500).json({ error: "No se pudo generar el Excel" });
  }
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
});
