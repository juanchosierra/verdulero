import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "https://verdulero.vercel.app/api/chat";
const COUNT = Math.max(1, Number(process.env.SIM_COUNT || "100"));
const MAX_TURNS = Math.max(4, Number(process.env.SIM_MAX_TURNS || "14"));
const CONCURRENCY = Math.max(1, Number(process.env.SIM_CONCURRENCY || "20"));
const SUITE = process.env.SIM_SUITE || "default";
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.SIM_REQUEST_DELAY_MS || "350"));

const FIRST_NAMES = ["Paola", "Javier", "Juan", "Laura", "Pedro", "Sonia", "Carlos", "Ana", "Julia", "Mario"];
const LAST_NAMES = ["Rodriguez", "Jimenez", "Sierra", "Perez", "Gomez", "Torres", "Mendez", "Rojas", "Colmenares", "Dager"];
const STREETS = [
  "calle 10 #20-30",
  "carrera 22 #45-18",
  "calle 36 #19-44",
  "cra 27 #14-08",
  "transversal 93 #34-22"
];
const CITIES = ["bucaramanga", "floridablanca", "giron", "piedecuesta"];

const PRODUCT_MESSAGES = [
  "dame 2 libras de tomate chonto",
  "quiero 3 libras de papa criolla",
  "media libra de cilantro",
  "dame 2 libras de zanahoria, 3 de tomate y 1 cebolla",
  "cuanto vale la papa",
  "tiene tomate chonto",
  "5 de papa",
  "2 de papa 3 limones 5 pinas"
];

const CHAOTIC_PRODUCT_MESSAGES = [
  "dame 2 libras de zanahoria, 3 de tomate, 4 de papa negra, 3 libra de cebolla larga y cabezona, una sandia, dos libras de yuca y un frasco de zumo de limon",
  "necesito 3 libas de tomte chonto y 2 de papa negra porfa veci",
  "quiero media libra de cilantro, 2 limones y una pina perolera",
  "tomate cherry no, tomate chonto 3 libras",
  "hagame una canasta nueva con 2 de papa 3 limones 5 pinas y 5 zanahorias",
  "hola veci me manda 2 libras de cebolla cabezona y una sandia",
  "quiero 1 libra de yuca, 2 de cebolla larga pelada y 1 zumo de limon",
  "veci necesito algo para el sancocho, pero si no hay combo me arma arracacha y mazorca"
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const THANKS_PATTERN = /\b(gracias|muchas gracias|mil gracias|todo bien|listo gracias)\b/i;
const ORDER_REPLY_PATTERN = /subtotal|tirilla de compra|total a pagar|le agreg|anotad|carrito|cu[aá]ntas le doy|cu[aá]ntos le empaco|opciones reales|cu[aá]l le doy/i;
const CLOSE_PROMPT_PATTERN = /¿qu[eé] m[aá]s necesita|algo m[aá]s|nada m[aá]s|si quiere confirmar|conf[ií]rmame|contraentrega|correo electr[oó]nico|direccion de entrega|n[uú]mero de whatsapp/i;
const CONFIRM_REPLY_PATTERN = /pedido confirmado|su orden es|le envi[eé] la tirilla|qued[oó] confirmado|tirilla/i;
const ASK_START_MODAL_PATTERN = /correo electr[oó]nico|ciudad|nombre completo|completa tu correo|modal de entrada/i;
const ASK_CHECKOUT_PATTERN = /correo electr[oó]nico|direccion de entrega|n[uú]mero de whatsapp|conf[ií]rmame con "si" o "no"/i;

const PERSONAS = [
  {
    id: "nuevo_normal",
    weight: 30,
    buildScript(ctx) {
      return [
        ctx.productLine,
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si",
        "gracias"
      ];
    }
  },
  {
    id: "plural_numero_palabra",
    weight: 12,
    buildScript() {
      return [
        "tres aguacates",
        "dos cebollas",
        "once aguacates",
        "treinta y dos limones",
        "nada mas"
      ];
    }
  },
  {
    id: "nuevo_mezcla_datos",
    weight: 14,
    buildScript(ctx) {
      return [
        ctx.productLine,
        ...(ctx.productLine === "2 de papa 3 limones 5 pinas" ? ["en libras"] : []),
        ctx.checkoutPhone,
        ctx.address,
        "gracias"
      ];
    }
  },
  {
    id: "recurrente_nueva_canasta",
    weight: 18,
    buildScript(ctx) {
      return [
        "una canasta nueva",
        ctx.productLine,
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si"
      ];
    }
  },
  {
    id: "frustrado",
    weight: 8,
    buildScript(ctx) {
      return [
        "no vales monda",
        "media libra de cilantro",
        ctx.checkoutPhone,
        ctx.address,
        "gracias"
      ];
    }
  },
  {
    id: "correccion_producto",
    weight: 10,
    buildScript(ctx) {
      return [
        "dame 3 libras de tomate",
        "tomate cherry no, tomate chonto",
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si"
      ];
    }
  },
  {
    id: "solo_precio",
    weight: 10,
    buildScript(ctx) {
      return [
        "cuanto vale la papa",
        "gracias"
      ];
    }
  },
  {
    id: "solo_disponibilidad",
    weight: 10,
    buildScript(ctx) {
      return [
        "tiene papa",
        "gracias"
      ];
    }
  },
  {
    id: "datos_todo_junto",
    weight: 10,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        `${ctx.productLine} y mi numero es ${ctx.checkoutPhone} y mi direccion ${ctx.address}`,
        ctx.followUpClose,
        ctx.confirmWord,
        "gracias"
      ];
    }
  },
  {
    id: "pedido_antes_del_intake",
    weight: 10,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        ctx.chaoticProductLine,
        "con eso mismo",
        ctx.checkoutPhone,
        ctx.address,
        ctx.followUpClose,
        ctx.confirmWord
      ];
    }
  },
  {
    id: "ortografia_salvaje",
    weight: 10,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        ctx.typoProductLine,
        ctx.checkoutPhone,
        ctx.address,
        ctx.followUpClose,
        ctx.confirmWord
      ];
    }
  },
  {
    id: "cambio_idea_medio_pedido",
    weight: 9,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "dame 3 libras de tomate",
        "tomate cherry no, tomate chonto",
        "mejor dejelo en 2 libras",
        ctx.checkoutPhone,
        ctx.address,
        ctx.followUpClose,
        ctx.confirmWord
      ];
    }
  },
  {
    id: "hostil_con_pedido",
    weight: 7,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "hola veci no me vaya a salir con bobadas",
        "dame media libra de cilantro y 2 libras de tomate chonto",
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si",
        "gracias"
      ];
    }
  },
  {
    id: "cierre_coloquial",
    weight: 8,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "quiero 3 libras de papa criolla",
        ctx.followUpClose,
        ctx.checkoutPhone,
        ctx.address,
        ctx.confirmWord,
        "todo bien gracias"
      ];
    }
  },
  {
    id: "unidad_ambigua_resuelta",
    weight: 8,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "2 de papa 3 limones 5 pinas",
        "en libras",
        ctx.checkoutPhone,
        ctx.address,
        ctx.followUpClose,
        ctx.confirmWord
      ];
    }
  },
  {
    id: "variante_contexto",
    weight: 10,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "5 de papa",
        "en libras",
        "pastusa lavada",
        "4 libras de zanahoria",
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si"
      ];
    }
  },
  {
    id: "decision_nuevo",
    weight: 8,
    suites: ["aggressive"],
    buildScript(ctx) {
      return [
        "uno nuevo",
        "5 libras de zanahoria",
        "nada mas",
        ctx.checkoutPhone,
        ctx.address,
        "si"
      ];
    }
  }
];

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function weightedPick(items) {
  const total = items.reduce((acc, item) => acc + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function buildContext(index) {
  const first = randomOf(FIRST_NAMES);
  const last = randomOf(LAST_NAMES);
  const productLine = randomOf(PRODUCT_MESSAGES);
  return {
    index,
    fullName: `${first} ${last}`,
    email: `${first}.${last}.${index}@simulacion.test`.toLowerCase(),
    checkoutPhone: `3${Math.floor(100000000 + Math.random() * 899999999)}`,
    address: randomOf(STREETS),
    city: randomOf(CITIES),
    productLine,
    chaoticProductLine: randomOf(CHAOTIC_PRODUCT_MESSAGES),
    typoProductLine: randomOf([
      "media libra de silantro",
      "3 libas de tomte chonto",
      "2 libras de papa ngera",
      "un frasco de sumo de limon",
      "2 de pina perolra"
    ]),
    followUpClose: randomOf(["nada mas", "no mas veci", "listo veci no mas", "eso seria todo", "hágale no más"]),
    confirmWord: randomOf(["si", "sí", "de una", "hagale", "confirmo"])
  };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectUserData(user) {
  const normalized = normalizeText(user);
  const hasEmail = EMAIL_PATTERN.test(user);
  const hasAddress = /\b(calle|carrera|cra|transversal|avenida|av|diag|diagonal)\b/i.test(user);
  const hasCity = /\b(bucaramanga|floridablanca|giron|piedecuesta)\b/i.test(normalized);
  const cleaned = normalized.replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const hasName =
    /\b(mi nombre es|soy)\b/i.test(normalized) ||
    (/^[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){1,2}$/i.test(cleaned) &&
      !/(hola|buenas|buenos|tardes|noches|gracias|veci|sumerc[eé]|hagale|listo|pedido|canasta|no vales|monda|joda|carajos|idiota)/i.test(cleaned) &&
      !hasEmail &&
      !hasAddress &&
      !hasCity &&
      false);

  return { hasName, hasEmail, hasAddress, hasCity };
}

async function post(sessionId, payload) {
  if (REQUEST_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        typeof payload === "string"
          ? { sessionId, messages: [{ role: "user", content: payload }] }
          : { sessionId, ...payload }
      )
    });

    if (res.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }
  throw new Error("HTTP 429: demasiados intentos seguidos");
}

function classifyFailure({ transcript, contract }) {
  const lastUser = transcript[transcript.length - 1]?.user || "";
  const lastReply = transcript[transcript.length - 1]?.reply || "";
  const combined = transcript.map((t) => `${t.user} || ${t.reply}`).join("\n").toLowerCase();

  if (/claro, veci\. digame producto y cantidad/i.test(lastReply) && /gracias/i.test(lastUser)) {
    return { type: "reabre_venta", severity: "alta", reason: "Reabrió la venta tras agradecimiento." };
  }
  if (/no tengo|no encontre|no encontr[eé]/i.test(lastReply) && /piña|pina/.test(lastUser.toLowerCase())) {
    return { type: "inventario_dudoso", severity: "alta", reason: "Marcó posible falso negativo de inventario." };
  }
  if (/papaya/i.test(lastReply) && /papa/i.test(lastUser.toLowerCase())) {
    return { type: "match_incorrecto", severity: "critica", reason: "Confundió papa con papaya." };
  }
  if (
    EMAIL_PATTERN.test(lastReply) &&
    !/@/.test(lastUser) &&
    !/envi[eé] el resumen al correo|correo .*simulacion\.test/i.test(lastReply)
  ) {
    return { type: "contaminacion_correo", severity: "critica", reason: "El bot arrastró el correo como si fuera dato de producto o dirección." };
  }
  if (contract?.stage === "captura_datos" && /nada mas|si$/i.test(lastUser)) {
    return { type: "cierre_sin_intake", severity: "media", reason: "Intentó cerrar sin completar intake." };
  }
  if (!contract?.next_action) {
    return { type: "sin_contrato", severity: "alta", reason: "No devolvió contrato utilizable." };
  }
  return { type: "otro", severity: "media", reason: "Fallo no clasificado automaticamente." };
}

function evaluateConversation(transcript) {
  const errors = [];
  let finalContract = null;
  let sawOrderLikeMessage = false;
  let sawCheckoutPrompt = false;
  let sawCheckoutConfirmation = false;

  transcript.forEach((turn, index) => {
    const reply = String(turn.reply || "");
    const contract = turn.contract || null;
    finalContract = contract || finalContract;
    const user = String(turn.user || "");
    const normalizedUser = normalizeText(user);
    const normalizedReply = normalizeText(reply);
    const detected = detectUserData(user);
    if (
      !/\b(cuanto vale|cuánto vale|tiene|hay)\b/i.test(normalizedUser) &&
      (
        /\d/.test(user) && /(libra|libras|kilo|kg|unidad|unidades|und|tomate|papa|cebolla|zanahoria|cilantro|limon|piña|pina)/i.test(user) ||
        /\b(dame|deme|quiero|necesito|agrega)\b/i.test(normalizedUser)
      )
    ) {
      sawOrderLikeMessage = true;
    }
    if (/tirilla de compra|total a pagar|si quiere confirmar|confirmeme|confirmar/i.test(reply)) {
      sawCheckoutPrompt = true;
    }
    if (CONFIRM_REPLY_PATTERN.test(reply)) {
      sawCheckoutConfirmation = true;
    }

    if (!contract) {
      errors.push({
        turn: index + 1,
        type: "sin_contrato",
        severity: "alta",
        reason: "La API no devolvió contract."
      });
    }

    if (/papaya/i.test(reply) && /papa/i.test(String(turn.user).toLowerCase())) {
      errors.push({
        turn: index + 1,
        type: "match_incorrecto",
        severity: "critica",
        reason: "Confundió papa con papaya."
      });
    }

    if (contract?.fields_detected?.correo && contract?.fields_detected?.direccion) {
      const correo = String(contract.fields_detected.correo).toLowerCase();
      const direccion = String(contract.fields_detected.direccion).toLowerCase();
      if (correo === direccion || /@/.test(direccion)) {
        errors.push({
          turn: index + 1,
          type: "direccion_contaminada",
          severity: "critica",
          reason: "Registró correo como si fuera dirección."
        });
      }
    }

    if (
      EMAIL_PATTERN.test(reply) &&
      !/@/.test(user) &&
      !/envi[eé] el resumen al correo|correo .*simulacion\.test/i.test(reply)
    ) {
      errors.push({
        turn: index + 1,
        type: "contaminacion_correo",
        severity: "critica",
        reason: "El bot arrastró el correo como si fuera dato de producto o dirección."
      });
    }

    if (ASK_START_MODAL_PATTERN.test(normalizedReply)) {
      errors.push({
        turn: index + 1,
        type: "repregunta_modal",
        severity: "critica",
        reason: "El bot pidió de nuevo datos del modal inicial dentro del chat."
      });
    }

    if (detected.hasEmail && /correo.*arrancar|correo.*empezar el chat/i.test(normalizedReply)) {
      errors.push({
        turn: index + 1,
        type: "dato_ignorado_correo",
        severity: "critica",
        reason: "Volvió a pedir el correo inicial dentro del chat."
      });
    }

    if (detected.hasAddress && /direccion de entrega|direccion exacta/i.test(normalizedReply) && !sawCheckoutPrompt) {
      errors.push({
        turn: index + 1,
        type: "dato_ignorado_direccion",
        severity: "alta",
        reason: "Pidió dirección fuera del cierre o la repitió sin necesidad."
      });
    }

    if (detected.hasCity && /ciudad/i.test(normalizedReply) && !sawCheckoutPrompt) {
      errors.push({
        turn: index + 1,
        type: "dato_ignorado_ciudad",
        severity: "alta",
        reason: "Pidió ciudad dentro del chat cuando ya debia venir del modal."
      });
    }

    if (THANKS_PATTERN.test(user) && /digame producto|que le anoto hoy|que mas necesita|que le vamos a poner/i.test(normalizedReply)) {
      errors.push({
        turn: index + 1,
        type: "reabre_venta",
        severity: "alta",
        reason: "El bot reabrió la venta después de un cierre/agradecimiento."
      });
    }
  });

  const awaitingUnitClarification = transcript.some((turn) => /libras o en unidades|libras o unidades/i.test(String(turn.reply)));
  const gracefullyDeclinedUnavailable = transcript.some((turn) => /no tengo|no encontr[eé]|le ofrezco otra opci[oó]n/i.test(String(turn.reply)));
  if (
    sawOrderLikeMessage &&
    !gracefullyDeclinedUnavailable &&
    !awaitingUnitClarification &&
    transcript.every((turn) => !/subtotal|tirilla de compra|total a pagar|le agreg/i.test(String(turn.reply)))
  ) {
    errors.push({
      turn: transcript.length,
      type: "pedido_no_procesado",
      severity: "critica",
      reason: "El cliente sí hizo un pedido, pero el bot nunca lo convirtió en carrito o resumen."
    });
  }

  const lastTurn = transcript[transcript.length - 1];
  if (lastTurn && THANKS_PATTERN.test(String(lastTurn.user)) && /digame producto|que le anoto hoy|que mas necesita/i.test(String(lastTurn.reply))) {
    errors.push({
      turn: transcript.length,
      type: "cierre_no_respetado",
      severity: "alta",
      reason: "El bot no respetó el cierre final del cliente."
    });
  }

  if (sawCheckoutPrompt && !sawCheckoutConfirmation) {
    const anyUserConfirm = transcript.some((turn) => /\b(si|sí|de una|hagale|confirmo)\b/i.test(String(turn.user)));
    if (anyUserConfirm) {
      errors.push({
        turn: transcript.length,
        type: "confirmacion_no_cerrada",
        severity: "critica",
        reason: "El cliente sí confirmó, pero el bot no cerró con pedido confirmado."
      });
    }
  }

  if (errors.length === 0 && transcript.length > 0) {
    const inferred = classifyFailure({
      transcript,
      contract: finalContract
    });
    if (inferred.type !== "otro" && inferred.type !== "sin_contrato") {
      errors.push({ turn: transcript.length, ...inferred });
    }
  }

  return {
    ok: errors.length === 0,
    finalContract,
    errors
  };
}

async function runSimulation(index) {
  const ctx = buildContext(index);
  const availablePersonas = PERSONAS.filter((persona) => {
    if (!persona.suites || persona.suites.length === 0) return true;
    return persona.suites.includes(SUITE);
  });
  const persona = weightedPick(availablePersonas);
  const sessionId = `sim_${persona.id}_${Date.now()}_${index}_${Math.floor(Math.random() * 9999)}`;
  const script = persona.buildScript(ctx).slice(0, MAX_TURNS);
  const transcript = [];

  const bootstrapPayload = {
    bootstrapProfile: {
      correo: ctx.email,
      ciudad: ctx.city,
      nombre: ctx.fullName
    }
  };
  const bootstrapResponse = await post(sessionId, bootstrapPayload);
  transcript.push({
    user: "[bootstrapProfile]",
    reply: String(bootstrapResponse?.content || ""),
    contract: bootstrapResponse?.contract || null
  });

  for (const message of script) {
    const response = await post(sessionId, message);
    transcript.push({
      user: message,
      reply: String(response?.content || ""),
      contract: response?.contract || null
    });
  }

  const evaluation = evaluateConversation(transcript);
  return {
    sessionId,
    persona: persona.id,
    transcript,
    ...evaluation
  };
}

function summarize(results) {
  const byPersona = {};
  const errorBuckets = {};

  for (const result of results) {
    byPersona[result.persona] = byPersona[result.persona] || { total: 0, ok: 0, fail: 0 };
    byPersona[result.persona].total += 1;
    if (result.ok) byPersona[result.persona].ok += 1;
    else byPersona[result.persona].fail += 1;

    for (const error of result.errors) {
      errorBuckets[error.type] = errorBuckets[error.type] || {
        total: 0,
        severity: error.severity,
        samples: []
      };
      errorBuckets[error.type].total += 1;
      if (errorBuckets[error.type].samples.length < 5) {
        errorBuckets[error.type].samples.push(error.reason);
      }
    }
  }

  return { byPersona, errorBuckets };
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = new Array(COUNT);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= COUNT) return;

      const result = await runSimulation(current + 1);
      results[current] = result;
      completed += 1;
      process.stdout.write(`${completed}/${COUNT} ${result.ok ? "OK" : "FAIL"} ${result.persona}\n`);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, COUNT) }, () => worker())
  );

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const { byPersona, errorBuckets } = summarize(results);

  const outDir = path.join(process.cwd(), "docs", "simulations");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = path.join(outDir, `simulation-${COUNT}-${timestamp}.json`);
  fs.writeFileSync(rawPath, JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    count: COUNT,
    suite: SUITE,
    maxTurns: MAX_TURNS,
    results
  }, null, 2), "utf8");

  const reportLines = [];
  reportLines.push(`# Simulacion masiva de conversaciones`);
  reportLines.push("");
  reportLines.push(`- Fecha: ${startedAt}`);
  reportLines.push(`- Endpoint: ${BASE_URL}`);
  reportLines.push(`- Conversaciones: ${COUNT}`);
  reportLines.push(`- Suite: ${SUITE}`);
  reportLines.push(`- OK: ${okCount}`);
  reportLines.push(`- FAIL: ${failCount}`);
  reportLines.push(`- Tasa de exito: ${((okCount / Math.max(1, COUNT)) * 100).toFixed(1)}%`);
  reportLines.push("");
  reportLines.push("## Rendimiento por perfil");
  for (const [persona, stats] of Object.entries(byPersona)) {
    reportLines.push(`- ${persona}: ${stats.ok}/${stats.total} OK`);
  }
  reportLines.push("");
  reportLines.push("## Top errores");
  const topErrors = Object.entries(errorBuckets)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  if (topErrors.length === 0) {
    reportLines.push("- Sin errores detectados en este lote.");
  } else {
    for (const [type, bucket] of topErrors) {
      reportLines.push(`- ${type}: ${bucket.total} casos (${bucket.severity})`);
    }
  }
  reportLines.push("");
  reportLines.push("## Conversaciones fallidas de muestra");
  const failed = results.filter((r) => !r.ok).slice(0, 10);
  if (failed.length === 0) {
    reportLines.push("- Sin fallos de muestra.");
  } else {
    for (const sample of failed) {
      reportLines.push(`- ${sample.sessionId} [${sample.persona}]`);
      for (const turn of sample.transcript.slice(0, 6)) {
        reportLines.push(`  USER: ${turn.user}`);
        reportLines.push(`  BOT: ${turn.reply}`);
      }
      for (const error of sample.errors) {
        reportLines.push(`  ERROR: ${error.type} - ${error.reason}`);
      }
    }
  }
  reportLines.push("");
  reportLines.push(`- Raw JSON: ${rawPath}`);

  const reportPath = path.join(outDir, `simulation-${COUNT}-${timestamp}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(`Reporte generado: ${reportPath}`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
