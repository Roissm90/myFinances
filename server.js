const express = require("express");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { MongoClient } = require("mongodb");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "misfinanzas";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";

const AUTH_COOKIE = "app_auth";
const AUTH_TOKEN = APP_PASSWORD
  ? crypto.createHash("sha256").update(APP_PASSWORD).digest("hex")
  : "";

let mongoDb = null;
let movementsCollection = null;
let yearsCollection = null;

const ENCRYPTION_ALGO = "aes-256-gcm";
const ENCRYPTION_IV_LENGTH = 12;

const getEncryptionKey = () => {
  if (!ENCRYPTION_KEY) {
    return null;
  }

  const keyBuffer = Buffer.from(ENCRYPTION_KEY, "base64");
  if (keyBuffer.length !== 32) {
    return null;
  }
  return keyBuffer;
};

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));


const getCookieValue = (req, name) => {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((item) => item.trim());
  const match = parts.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
};

const isAuthenticated = (req) => {
  if (!APP_PASSWORD) {
    return true;
  }
  const token = getCookieValue(req, AUTH_COOKIE);
  if (!token || !AUTH_TOKEN) {
    return false;
  }
  return token === AUTH_TOKEN;
};

const renderLoginPage = (message) => `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mis Finanzas - Login</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #afcfbd; margin: 0; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }
      .card { width: 100%; max-width: 480px; background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.08); }
      h1 { margin: 0 0 1rem; color: #333; font-size: 1.5rem; }
      label { display: block; margin-bottom: 0.35rem; color: #333; }
      input { width: 100%; padding: 0.65rem 0.75rem; border: 1px solid #005e2a; border-radius: 6px; font-size: 1rem; }
      button { width: 100%; margin-top: 1rem; padding: 0.65rem; background: #005e2a; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
      .message { margin: 1rem 0 0; color: #c62828; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <form class="card" method="post" action="/login">
        <h1>Acceso</h1>
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" required />
        ${message ? `<p class="message">${message}</p>` : ""}
        <button type="submit">Entrar</button>
      </form>
    </div>
  </body>
</html>`;

const authGuard = (req, res, next) => {
  if (!APP_PASSWORD) {
    return next();
  }
  const pathName = req.path;
  if (pathName === "/login" || pathName === "/logout" || pathName === "/health") {
    return next();
  }
  if (pathName === "/favicon.svg") {
    return next();
  }
  if (isAuthenticated(req)) {
    return next();
  }

  const isApiPath =
    pathName.startsWith("/upload") ||
    pathName.startsWith("/uploads") ||
    pathName.startsWith("/export-summary");

  if (isApiPath || req.headers.accept?.includes("application/json")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  return res.redirect("/login");
};

app.use(authGuard);
app.use(authGuard);

// Endpoint para devolver el nombre de usuario (después del authGuard, antes del static)
app.get('/api/app-username', (req, res) => {
  res.json({ username: process.env.APP_USERNAME || '' });
});
app.use(express.static(__dirname));

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }
  return res.send(renderLoginPage(""));
});

app.post("/login", (req, res) => {
  if (!APP_PASSWORD) {
    return res.redirect("/");
  }
  const password = String(req.body?.password || "");
  if (password === APP_PASSWORD) {
    res.cookie(AUTH_COOKIE, AUTH_TOKEN, {
      httpOnly: true,
      sameSite: "lax",
    });
    return res.redirect("/");
  }
  return res.status(401).send(renderLoginPage("Contraseña incorrecta"));
});

app.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  return res.redirect("/login");
});

app.get("/years", async (_req, res) => {
  try {
    if (!requireMongo(res)) {
      return;
    }
    const yearsFromMovements = await movementsCollection.distinct("year");
    const yearsFromCollection = yearsCollection
      ? await yearsCollection.distinct("year")
      : [];
    const combined = [...yearsFromMovements, ...yearsFromCollection]
      .map((value) => normalizeYear(value))
      .filter(Boolean);

    const uniqueYears = Array.from(new Set(combined));
    if (!uniqueYears.length) {
      uniqueYears.push(getCurrentYear());
    }

    uniqueYears.sort((a, b) => a - b);
    return res.json({ years: uniqueYears });
  } catch (error) {
    return res.status(500).json({ error: "No se pudieron listar anos" });
  }
});

app.post("/years", async (req, res) => {
  try {
    if (!requireMongo(res)) {
      return;
    }
    const year = normalizeYear(req.body?.year);
    if (!year) {
      return res.status(400).json({ error: "Ano invalido" });
    }
    if (yearsCollection) {
      await yearsCollection.updateOne(
        { year },
        { $set: { year, createdAt: new Date() } },
        { upsert: true }
      );
    }
    return res.json({ year });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo crear el ano" });
  }
});

const sanitizeMonth = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "");

const getCurrentYear = () => new Date().getFullYear();

const normalizeYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return null;
  }
  return year;
};

const buildFileName = (monthKey, yearValue) => {
  const year = normalizeYear(yearValue) ?? getCurrentYear();
  return `movimientos-${year}-${monthKey}.json`;
};

const parseYearFromFileName = (fileName) => {
  const match = String(fileName ?? "").match(/^movimientos-(\d{4})-/);
  return match ? normalizeYear(match[1]) : null;
};

const parseMonthKeyFromFileName = (fileName) =>
  String(fileName ?? "")
    .replace(/^movimientos-\d{4}-/, "")
    .replace(/^movimientos-/, "")
    .replace(/\.json$/i, "")
    .trim();

const requireMongo = (res) => {
  if (!movementsCollection) {
    res.status(500).json({ error: "MongoDB no inicializado" });
    return false;
  }
  return true;
};

const requireEncryptionKey = (res) => {
  if (!getEncryptionKey()) {
    res.status(500).json({ error: "Clave de cifrado invalida" });
    return false;
  }
  return true;
};

const buildYearQuery = (yearValue) => {
  const year = normalizeYear(yearValue);
  if (!year) {
    return {};
  }
  if (year === getCurrentYear()) {
    return { $or: [{ year }, { year: { $exists: false } }] };
  }
  return { year };
};

const encryptMovements = (movements) => {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error("Clave de cifrado invalida");
  }

  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(movements), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    content: encrypted.toString("base64"),
  };
};

const decryptMovements = (payload) => {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error("Clave de cifrado invalida");
  }

  if (!payload?.iv || !payload?.tag || !payload?.content) {
    return [];
  }

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const content = Buffer.from(payload.content, "base64");

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(content),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
};

const getMovementsFromDoc = (doc) => {
  if (doc?.encryptedMovements) {
    return decryptMovements(doc.encryptedMovements);
  }
  if (Array.isArray(doc?.movements)) {
    return doc.movements;
  }
  return [];
};

const writeMovements = async (month, year, encryptedMovements) => {
  const monthKey = sanitizeMonth(month);
  const normalizedYear = normalizeYear(year) ?? getCurrentYear();
  await movementsCollection.updateOne(
    { monthKey, year: normalizedYear },
    {
      $set: {
        month,
        monthKey,
        year: normalizedYear,
        encryptedMovements,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return buildFileName(monthKey, normalizedYear);
};

app.get("/check-exists", async (req, res) => {
  try {
    const { month, year } = req.query;
    
    if (typeof month !== "string" || month.trim() === "") {
      return res.status(400).json({ error: "Mes requerido" });
    }

    if (!requireMongo(res)) {
      return;
    }

    const monthKey = sanitizeMonth(month);
    const normalizedYear = normalizeYear(year) ?? getCurrentYear();
    
    const doc = await movementsCollection.findOne({
      monthKey,
      year: normalizedYear,
    });

    return res.json({ exists: !!doc });
  } catch (error) {
    return res.status(500).json({ error: "Error al verificar archivo" });
  }
});

app.post("/upload", async (req, res) => {
  try {
    const { data, month, year } = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: "Formato invalido" });
    }

    if (typeof month !== "string" || month.trim() === "") {
      return res.status(400).json({ error: "Mes requerido" });
    }

    if (!requireMongo(res)) {
      return;
    }

    if (!requireEncryptionKey(res)) {
      return;
    }

    const normalizedYear = normalizeYear(year) ?? getCurrentYear();

    const encryptedMovements = encryptMovements(data);
    const fileName = await writeMovements(
      month,
      normalizedYear,
      encryptedMovements
    );
    return res.json({ fileName, rows: data.length });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo guardar el archivo" });
  }
});

app.get("/uploads", async (req, res) => {
  try {
    if (!requireMongo(res)) {
      return;
    }

    const year = normalizeYear(req.query.year) ?? getCurrentYear();
    const yearQuery = buildYearQuery(year);

    const docs = await movementsCollection
      .find(yearQuery, { projection: { monthKey: 1, year: 1 } })
      .toArray();

    const files = docs
      .map((doc) => buildFileName(doc.monthKey, doc.year ?? year))
      .sort((a, b) => a.localeCompare(b));

    return res.json({ files });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo listar uploads" });
  }
});

app.get("/uploads/:fileName", async (req, res) => {
  try {
    const requested = path.basename(req.params.fileName || "");
    if (!requested.endsWith(".json")) {
      return res.status(400).json({ error: "Archivo invalido" });
    }

    if (!requireMongo(res)) {
      return;
    }

    const monthKey = parseMonthKeyFromFileName(requested);
    const parsedYear = parseYearFromFileName(requested);
    const year = parsedYear ?? normalizeYear(req.query.year) ?? getCurrentYear();
    const yearQuery = buildYearQuery(year);
    const doc = await movementsCollection.findOne({
      monthKey,
      ...yearQuery,
    });
    if (!doc) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    const movements = getMovementsFromDoc(doc);
    return res.json(Array.isArray(movements) ? movements : []);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo leer el archivo" });
  }
});

app.delete("/uploads/:fileName", async (req, res) => {
  try {
    const requested = path.basename(req.params.fileName || "");
    if (!requested.endsWith(".json")) {
      return res.status(400).json({ error: "Archivo invalido" });
    }

    if (!requireMongo(res)) {
      return;
    }

    const monthKey = parseMonthKeyFromFileName(requested);
    const parsedYear = parseYearFromFileName(requested);
    const year = parsedYear ?? normalizeYear(req.query.year) ?? getCurrentYear();
    const yearQuery = buildYearQuery(year);
    const result = await movementsCollection.deleteOne({
      monthKey,
      ...yearQuery,
    });
    if (!result.deletedCount) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    return res.json({ deleted: true });
  } catch (error) {
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
    .replace(/^movimientos-\d{4}-/, "")
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
    .replace(/^movimientos-\d{4}-/, "")
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
    if (!requireMongo(res)) {
      return;
    }

    if (!requireEncryptionKey(res)) {
      return;
    }

    const year = normalizeYear(_req.query.year) ?? getCurrentYear();
    const yearQuery = buildYearQuery(year);

    const docs = await movementsCollection
      .find(yearQuery, {
        projection: { monthKey: 1, month: 1, encryptedMovements: 1, year: 1 },
      })
      .toArray();

    const docsSorted = docs.sort((a, b) => {
      const indexA = getMonthIndex(buildFileName(a.monthKey, a.year ?? year));
      const indexB = getMonthIndex(buildFileName(b.monthKey, b.year ?? year));
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      return String(a.monthKey).localeCompare(String(b.monthKey));
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

    for (const doc of docsSorted) {
      const data = getMovementsFromDoc(doc);
      if (!Array.isArray(data)) {
        continue;
      }
      if (!data.length) {
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
        mes: formatMonthLabel(buildFileName(doc.monthKey, doc.year ?? year)),
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

const startServer = async () => {
  if (!MONGODB_URI) {
    console.error("Falta MONGODB_URI en el entorno");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  mongoDb = client.db(MONGODB_DB);
  movementsCollection = mongoDb.collection("movements");
  yearsCollection = mongoDb.collection("years");

  app.listen(port, () => {
    console.log(`Servidor listo en http://localhost:${port}`);
  });
};

startServer().catch((error) => {
  console.error("No se pudo conectar a MongoDB", error);
  process.exit(1);
});
