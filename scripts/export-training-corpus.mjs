import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    const current = process.env[key];
    if (!current) {
      process.env[key] = value;
      continue;
    }
    if (key === "DATABASE_URL" && !/^postgres(ql)?:\/\//i.test(current) && /^postgres(ql)?:\/\//i.test(value)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env.production"));
loadEnvFile(path.join(process.cwd(), ".env"));

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || "")) {
  throw new Error("DATABASE_URL no es PostgreSQL. Configure DATABASE_URL=postgresql://... para exportar el corpus.");
}

const prisma = new PrismaClient();

function classifyIntent(userText, assistantText) {
  const user = (userText || "").toLowerCase();
  const assistant = (assistantText || "").toLowerCase();

  if (/gracias|mil gracias|muchas gracias/.test(user)) return "agradecimiento";
  if (/cuanto vale|precio|vale\s+la/.test(user)) return "pregunta_precio";
  if (/tiene\s+|hay\s+/.test(user)) return "pregunta_disponibilidad";
  if (/nada mas|no mas|eso es todo|confirmar pedido|finalizar pedido/.test(user)) return "cierre";
  if (/pedido confirmado|orden es #/.test(assistant)) return "confirmacion";
  if (/no,| no\s+.*\s+no,/.test(user)) return "correccion";
  if (/\d/.test(user) && /(libra|libras|kilo|kg|unidad|unidades|und|de)/.test(user)) return "agregar_item";
  if (/nombre|whatsapp|correo|direccion|ciudad/.test(assistant)) return "captura_dato";
  return "otro";
}

function toJsonlRows(messages, maxRows = 2000) {
  const rows = [];
  for (let i = 1; i < messages.length; i += 1) {
    const prev = messages[i - 1];
    const cur = messages[i];
    if (prev.role !== "user" || cur.role !== "assistant") continue;

    rows.push({
      input: prev.content,
      output: cur.content,
      meta: {
        intent: classifyIntent(prev.content, cur.content),
        createdAt: cur.createdAt,
        sessionId: cur.sessionId
      }
    });
  }

  return rows.slice(-maxRows);
}

async function main() {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 1200,
    select: { id: true }
  });

  const outDir = path.join(process.cwd(), "docs", "training");
  fs.mkdirSync(outDir, { recursive: true });

  const dataset = [];
  for (const s of sessions) {
    const messages = await prisma.message.findMany({
      where: { sessionId: s.id },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        content: true,
        createdAt: true,
        sessionId: true
      }
    });
    dataset.push(...toJsonlRows(messages));
  }

  const dedup = new Map();
  for (const row of dataset) {
    const key = `${row.input}|||${row.output}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }

  const finalRows = Array.from(dedup.values()).slice(0, 5000);
  const jsonlPath = path.join(outDir, "chat-corpus.jsonl");
  fs.writeFileSync(
    jsonlPath,
    finalRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    sessions: sessions.length,
    pairs: finalRows.length,
    path: jsonlPath
  };

  fs.writeFileSync(path.join(outDir, "chat-corpus-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`Dataset generado: ${finalRows.length} pares en ${jsonlPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
