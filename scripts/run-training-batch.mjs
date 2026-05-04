import fs from "fs";

const BASE_URL = "https://verdulero.vercel.app/api/chat";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cols[i] || "").trim()));
    return row;
  });
}

async function post(sessionId, content) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, messages: [{ role: "user", content }] })
  });
  const data = await res.json();
  return String(data?.content || "");
}

function hasAny(text, patterns) {
  const t = text.toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

async function seedOnboarding(sessionId) {
  const replies = [];
  replies.push(await post(sessionId, "hola"));
  replies.push(await post(sessionId, "Paola Rodriguez"));
  const r3 = await post(sessionId, "3178905933");
  replies.push(r3);

  if (hasAny(r3, ["repetir su compra anterior", "ya vi su historial"])) {
    replies.push(await post(sessionId, "una canasta nueva"));
    return replies;
  }

  const r4 = await post(sessionId, "paola@test.com");
  replies.push(r4);
  if (hasAny(r4, ["direccion", "dirección"])) {
    replies.push(await post(sessionId, "calle 123 #45-67"));
    replies.push(await post(sessionId, "Bucaramanga"));
  }
  return replies;
}

async function evalScenario(row) {
  const sessionId = `train_${row.id}_${Math.random().toString(36).slice(2, 8)}`;
  const category = row.categoria;
  let pass = false;
  let evidence = "";
  let reason = "";

  try {
    if (category === "Onboarding") {
      const r = await post(sessionId, row.entrada_inicial || "hola");
      pass = hasAny(r, ["nombre completo", "su nombre"]);
      evidence = r;
      reason = pass ? "Pide nombre en primer turno" : "No pidió nombre";
    } else if (category === "Contexto") {
      await post(sessionId, "dame 2 libras de zanahoria y 3 de tomate");
      await seedOnboarding(sessionId);
      const r = await post(sessionId, "una canasta nueva con lo que te pedi");
      pass = hasAny(r, ["retom", "zanahoria", "tomate", "agregué"]);
      evidence = r;
      reason = pass ? "Retoma pedido previo" : "No retoma pedido previo";
    } else if (category === "Pedido") {
      await seedOnboarding(sessionId);
      const r = await post(sessionId, row.entrada_inicial || "dame 2 de tomate y 3 de cebolla");
      pass = hasAny(r, ["le agreg", "subtotal", "qué más necesita", "que mas necesita"]);
      evidence = r;
      reason = pass ? "Agrega al carrito y sigue venta" : "No agrega o no continúa venta";
    } else if (category === "MultiItem") {
      await post(sessionId, "dame 2 libras de zanahoria, 3 de tomate, 4 de papa");
      await seedOnboarding(sessionId);
      const r = await post(sessionId, row.entrada_inicial || "una canasta nueva con lo que te pedi");
      pass = hasAny(r, ["retom", "subtotal", "qué más necesita", "que mas necesita"]);
      evidence = r;
      reason = pass ? "Retoma y desglosa multi-item" : "No retoma multi-item";
    } else if (category === "Unidades") {
      await seedOnboarding(sessionId);
      const ask = await post(sessionId, "3 de tomate");
      const apply = await post(sessionId, "3 libras");
      pass = hasAny(ask, ["libras o en unidades", "libras o unidades"]) && hasAny(apply, ["le agreg", "subtotal"]);
      evidence = `${ask} || ${apply}`;
      reason = pass ? "Pregunta y aplica unidad" : "Falla manejo de unidad";
    } else if (category === "Correcciones") {
      await seedOnboarding(sessionId);
      await post(sessionId, "2 libras de tomate");
      const r = await post(sessionId, row.entrada_inicial || "tomate cherry no, chonto");
      pass = hasAny(r, ["le cambi", "cambié", "chonto"]);
      evidence = r;
      reason = pass ? "Corrige item en contexto" : "No corrige item";
    } else if (category === "Cierre") {
      await seedOnboarding(sessionId);
      await post(sessionId, "2 libras de tomate");
      const r = await post(sessionId, row.entrada_inicial || "nada mas");
      pass = hasAny(r, ["resumen final", "total", "fecha de entrega"]);
      evidence = r;
      reason = pass ? "Cierre correcto" : "No cierra correctamente";
    } else if (category === "Correo") {
      await seedOnboarding(sessionId);
      await post(sessionId, "2 libras de tomate");
      await post(sessionId, "nada mas");
      const r = await post(sessionId, row.entrada_inicial || "si confirmar");
      pass = hasAny(r, ["pedido confirmado", "orden es #", "envié el resumen", "envié el resumen"]);
      evidence = r;
      reason = pass ? "Confirma y notifica envío" : "No confirma cierre con envío";
    } else if (category === "Inventario") {
      await seedOnboarding(sessionId);
      const r = await post(sessionId, row.entrada_inicial || "quiero leche marca x");
      pass = hasAny(r, ["no tengo", "no encontr", "no veo"]);
      evidence = r;
      reason = pass ? "No inventa producto" : "Riesgo de invención";
    } else if (category === "Recurrente") {
      await seedOnboarding(sessionId);
      const r = await post(sessionId, row.entrada_inicial || "quiero repetir pedido");
      pass = hasAny(r, ["última compra", "ultima compra", "no veo una compra anterior", "repetir"]);
      evidence = r;
      reason = pass ? "Maneja recurrente" : "No maneja recurrente";
    } else {
      const r = await post(sessionId, row.entrada_inicial || "hola");
      pass = r.length > 0;
      evidence = r;
      reason = "Categoria no mapeada, smoke test";
    }
  } catch (e) {
    pass = false;
    evidence = String(e?.message || e);
    reason = "Error de ejecución";
  }

  return { ...row, resultado: pass ? "PASS" : "FAIL", razon: reason, evidencia: evidence.slice(0, 360).replace(/\n/g, " ") };
}

async function main() {
  const rows = parseCsv("docs/matriz-escenarios-v2.csv")
    .filter((r) => {
      const n = Number(String(r.id || "").replace("S", ""));
      return n >= 1 && n <= 50;
    });

  const results = [];
  for (const row of rows) {
    const r = await evalScenario(row);
    results.push(r);
    process.stdout.write(`${r.id} ${r.resultado} - ${r.razon}\n`);
  }

  const passCount = results.filter((r) => r.resultado === "PASS").length;
  const failCount = results.length - passCount;
  const criticalFails = results.filter((r) => r.prioridad === "Critica" && r.resultado === "FAIL");

  const outCsv = [
    "id,prioridad,categoria,subcategoria,resultado,razon,evidencia",
    ...results.map((r) => `${r.id},${r.prioridad},${r.categoria},${r.subcategoria},${r.resultado},\"${r.razon.replace(/\"/g, "'")}\",\"${r.evidencia.replace(/\"/g, "'")}\"`)
  ].join("\n");
  fs.writeFileSync("docs/resultados-s001-s050.csv", outCsv, "utf8");

  const byCat = {};
  for (const r of results) {
    byCat[r.categoria] = byCat[r.categoria] || { total: 0, pass: 0, fail: 0 };
    byCat[r.categoria].total += 1;
    if (r.resultado === "PASS") byCat[r.categoria].pass += 1; else byCat[r.categoria].fail += 1;
  }

  const lines = [];
  lines.push("# Reporte Entrenamiento S001-S050");
  lines.push("");
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Resumen");
  lines.push(`- Total: ${results.length}`);
  lines.push(`- PASS: ${passCount}`);
  lines.push(`- FAIL: ${failCount}`);
  lines.push(`- Tasa PASS: ${((passCount / Math.max(results.length, 1)) * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("## Resultado por categoria");
  Object.entries(byCat).forEach(([k, v]) => {
    lines.push(`- ${k}: ${v.pass}/${v.total} PASS (FAIL ${v.fail})`);
  });
  lines.push("");
  lines.push("## Fallos criticos");
  if (criticalFails.length === 0) {
    lines.push("- Sin fallos criticos en este lote.");
  } else {
    criticalFails.slice(0, 20).forEach((f) => {
      lines.push(`- ${f.id} [${f.categoria}/${f.subcategoria}] ${f.razon}`);
      lines.push(`  Evidencia: ${f.evidencia}`);
    });
  }
  lines.push("");
  lines.push("## Archivos");
  lines.push("- Detalle CSV: docs/resultados-s001-s050.csv");
  lines.push("- Este reporte: docs/reporte-s001-s050.md");

  fs.writeFileSync("docs/reporte-s001-s050.md", lines.join("\n"), "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
