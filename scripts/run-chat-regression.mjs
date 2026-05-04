import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "https://verdulero.vercel.app/api/chat";
const NOW = new Date().toISOString();

function sessionId(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `reg_${safe}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function withVars(text, vars) {
  return text
    .replaceAll("$PHONE", vars.phone)
    .replaceAll("$EMAIL", vars.email)
    .replaceAll("$ADDRESS", vars.address)
    .replaceAll("$CITY", vars.city);
}

async function send(session, payload) {
  const body = typeof payload === "string"
    ? {
        sessionId: session,
        messages: [{ role: "user", content: payload }]
      }
    : {
        sessionId: session,
        ...payload
      };

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }

  const json = await res.json();
  return {
    reply: String(json?.content || ""),
    contract: json?.contract || null
  };
}

function includesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

const scenarios = [
  {
    id: "R000",
    name: "bootstrap_modal_actual",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["hola", [/(pedido|producto|cantidad|anoto|repetir tu mercado anterior|armamos uno nuevo|que te anoto)/i]]
    ]
  },
  {
    id: "R001",
    name: "no_duplica_si_sin_dato",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["una canasta nueva", [/(pedido|producto|cantidad|anoto)/i]],
      ["dame 2 libras de tomate", [/(que mas necesita|subtotal|necesito ese dato|correo|correo electrónico)/i]],
      ["nada mas", [/(whatsapp|direcci[oó]n|resumen final|confirmeme con "si"|confirmame con "si"|mercado va en)/i]],
      ["si", [/(whatsapp|direcci[oó]n|confirmeme por favor|confirmame por favor)/i]]
    ],
    assert(history) {
      const last = history[history.length - 1]?.reply || "";
      if (/confirmado y agregado al carrito/i.test(last)) {
        throw new Error("Duplicó canasta con 'sí' fuera de confirmación explícita.");
      }
    }
  },
  {
    id: "R002",
    name: "unidad_lb_en_resumen",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Laura Perez"
    },
    steps: [
      ["una canasta nueva", [/(pedido|producto|cantidad|anoto)/i]],
      ["dame 3 libras de tomate", [/(3\\s*lb|libras|subtotal)/i]],
      ["nada mas", [/(resumen final|tirilla|total a pagar|whatsapp|direcci[oó]n|mercado va en)/i]]
    ],
    assert(history) {
      const combined = history.map((h) => h.reply).join("\n");
      if (!/(3\s*lb\s+de\s+)/i.test(combined)) {
        throw new Error("No preservó unidad lb en las líneas del resumen.");
      }
      if (!/(tirilla de compra|total a pagar)/i.test(combined)) {
        throw new Error("No mostró formato tirilla en el resumen final.");
      }
    }
  },
  {
    id: "R003",
    name: "no_inventa_leche",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Pedro Gomez"
    },
    steps: [
      ["una canasta nueva", [/(pedido|producto|cantidad)/i]],
      ["quiero leche marca x", [/(no tengo|no encontre|no encontré|no manejo)/i]]
    ],
    assert(history) {
      const last = history[history.length - 1]?.reply || "";
      if (/(si hay|vale \$|marca y|te ofrezco leche)/i.test(last)) {
        throw new Error("Inventó disponibilidad/precio para leche, que no se vende.");
      }
    }
  },
  {
    id: "R004",
    name: "media_libra_interpreta_0_5",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana Torres"
    },
    steps: [
      ["media libra de cilantro", [/(0\.5|0,5|cilantro|subtotal)/i]]
    ]
  },
  {
    id: "R005",
    name: "frustracion_humana",
    steps: [
      ["no vales monda", [/(perdon|perdón|arranquemos limpio|d[íi]game producto)/i]]
    ]
  },
  {
    id: "R006",
    name: "detectar_repetir_otra_vez",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Mario Lopez"
    },
    steps: [
      ["eche otra vez", [/(repetir|no veo una compra anterior|d[ií]game qu[eé] le anoto)/i]]
    ]
  },
  {
    id: "R007",
    name: "correccion_producto",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Sonia Perez"
    },
    steps: [
      ["dame 2 libras de tomate", [/(cu[aá]l le doy|opciones reales|subtotal|qu[eé] m[aá]s necesita)/i]],
      ["tomate cherry no, tomate chonto", [/(le cambi[eé]|no encontr[eé]|otro nombre|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R008",
    name: "multi_item_pide_unidad",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Carlos Mendez"
    },
    steps: [
      ["2 de papa 3 limones 5 pinas", [/(libras o en unidades|cantidades son en libras o en unidades)/i]]
    ]
  },
  {
    id: "R009",
    name: "gracias_post_confirmacion",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Julia Rojas"
    },
    steps: [
      ["una canasta nueva", [/(pedido|producto|cantidad|anoto)/i]],
      ["dame 1 libra de tomate", [/(subtotal|qu[eé] m[aá]s necesita|cu[aá]l le doy|opciones reales)/i]],
      ["cherry", [/(subtotal|qu[eé] m[aá]s necesita|agregu[eé]|agregue)/i]],
      ["nada mas", [/(whatsapp|mercado va en|env[ií]o|direcci[oó]n exacta)/i]],
      ["$PHONE", [/(direcci[oó]n exacta|entrega)/i]],
      ["$ADDRESS", [/(resumen final|tirilla|conf[ií]rmeme con \"s[ií]\"|si o no|total a pagar)/i]],
      ["si", [/(pedido confirmado|su orden es #)/i]],
      ["gracias", [/(pedido listo y confirmado|gracias por comprar|con gusto)/i]]
    ]
  },
  {
    id: "R010",
    name: "precio_directo",
    steps: [
      ["cuanto vale la papa", [/(si hay|vale|precio|no tengo|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R011",
    name: "disponibilidad_directa",
    steps: [
      ["tiene papa", [/(si hay|no tengo|cuantas le doy|cu[aá]ntas le doy|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R013",
    name: "unidad_real_producto",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Colmenares"
    },
    steps: [
      ["cilantro", [/(atados|atado|cilantro completo)/i]],
      ["2", [/(2\s+(atado|atados)|subtotal|que m[aá]s necesita)/i]]
    ]
  },
  {
    id: "R012",
    name: "agradecimiento_general",
    steps: [
      ["gracias", [/(con mucho gusto|aqu[ií] estoy|con gusto)/i]]
    ]
  },
  {
    id: "R014",
    name: "plural_aguacates_numero_palabra",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["tres aguacates", [/(aguacate|aguacate hass|subtotal|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R015",
    name: "plural_cebollas_numero_digito",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["5 cebollas", [/(cebolla|subtotal|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R016",
    name: "numero_once_equivale_11",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["once aguacates", [/(aguacate|aguacate hass|subtotal|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R017",
    name: "numero_compuesto_treinta_y_dos",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["treinta y dos limones", [/(limon|subtotal|cu[aá]l le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R018",
    name: "sinonimo_kilo_con_k",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["2 k de cebolla junca", [/(cebolla larga|cebolla junca|subtotal|2\s*(kg|kilos|lb|libras))/i]]
    ]
  },
  {
    id: "R019",
    name: "decision_uno_nuevo",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["uno nuevo", [/(mercado nuevo|que te anoto primero|armamos un mercado nuevo)/i]]
    ]
  },
  {
    id: "R020",
    name: "pedido_multiple_tres_items",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["ponme 2 libras de tomate, 1 kilo de papa y 3 aguacates", [/(tomate|papa|aguacate|cu[aá]l le doy|subtotal|opciones reales)/i]]
    ],
    assert(history) {
      const combined = history.map((h) => h.reply).join("\n").toLowerCase();
      const hitCount = ["tomate", "papa", "aguacate"].filter((token) => combined.includes(token)).length;
      if (hitCount < 2) {
        throw new Error("El pedido múltiple no dejó rastro suficiente de los productos esperados.");
      }
    }
  },
  {
    id: "R021",
    name: "cierre_no_ignora_ultimo_item",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Paola Rodriguez"
    },
    steps: [
      ["agrégame un plátano dominico y eso sería todo", [/(pl[aá]tano|dominico|confirmar pedido|subtotal|total a pagar|resumen final)/i]]
    ]
  },
  {
    id: "R022",
    name: "pedido_multiple_encadenado_hasta_el_final",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["2 de papa 3 limones 5 pinas", [/(papa|cu[aá]l le doy|opciones reales)/i]],
      ["pastusa lavada", [/(limon|limón|cu[aá]l le doy|opciones reales)/i]],
      ["criollo", [/(pi[nñ]a|cu[aá]l le doy|opciones reales)/i]],
      ["oro miel", [/(piña oro miel|qué más necesita|que más necesita)/i]]
    ],
    assert(history) {
      const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const combined = normalize(history.map((h) => h.reply).join("\n"));
      for (const token of ["papa pastusa lavada", "limon criollo", "pina oro miel"]) {
        if (!combined.includes(token)) {
          throw new Error(`No cerró bien la cola del pedido múltiple. Falta rastro de ${token}.`);
        }
      }
      const lastContract = history[history.length - 1]?.contract || {};
      if (normalize(lastContract.fields_detected?.nombre).includes("oro miel")) {
        throw new Error("Marcó una variante de producto como si fuera nombre del cliente.");
      }
    }
  },
  {
    id: "R023",
    name: "uno_nuevo_no_contamina_nombre",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["uno nuevo", [/(mercado nuevo|que te anoto primero)/i]]
    ],
    assert(history) {
      const firstContract = history[0]?.contract || {};
      const detectedName = String(firstContract.fields_detected?.nombre || "").toLowerCase();
      if (detectedName.includes("uno nuevo") || detectedName.includes("nuevo")) {
        throw new Error("Tomó una decisión de flujo como si fuera nombre del cliente.");
      }
    }
  },
  {
    id: "R024",
    name: "plural_aguacates_resuelve_variantes",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["tres aguacates", [/(aguacate|aguacate hass|cual le doy|opciones reales)/i]]
    ],
    assert(history) {
      const combined = String(history.map((h) => h.reply).join("\n")).toLowerCase();
      if (/no encontr[eé].*aguacat/.test(combined)) {
        throw new Error("Siguió singularizando mal 'aguacates'.");
      }
      if (!combined.includes("aguacate")) {
        throw new Error("No ofreció variantes reales para 'aguacates'.");
      }
    }
  },
  {
    id: "R025",
    name: "pinas_plural_pide_variante",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["5 piñas", [/(piña perolera|piña oro miel|cual le doy|opciones reales)/i]]
    ]
  },
  {
    id: "R026",
    name: "pregunta_otras_variantes_no_agrega",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["tomate", [/(tomate|cual le doy|opciones reales)/i]],
      ["que otros tomates hay", [/(tomate|opciones reales|cual le doy|si tengo|cat[aá]logo)/i]]
    ],
    assert(history) {
      const last = String(history[history.length - 1]?.reply || "").toLowerCase();
      if (/(ya los agregu[eé]|le agregu[eé]|subtotal|qu[eé] m[aá]s necesita)/i.test(last)) {
        throw new Error("Interpretó una pregunta de variantes como selección/agregado a canasta.");
      }
    }
  },
  {
    id: "R027",
    name: "typo_silantro_resuelve_cilantro",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["media libra de silantro", [/(cilantro|atado|atados|no en lb|no en libra)/i]]
    ],
    assert(history) {
      const last = String(history[history.length - 1]?.reply || "");
      if (/no encontr[eé].*silantro/i.test(last)) {
        throw new Error("No corrigió typo 'silantro' hacia cilantro.");
      }
    }
  },
  {
    id: "R028",
    name: "hostil_sin_pedido_no_inventa_producto",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["no me vaya a salir con bobadas", [/(perd[oó]n|arranquemos limpio|producto y cantidad)/i]]
    ],
    assert(history) {
      const last = String(history[history.length - 1]?.reply || "");
      if (/(si hay|cu[aá]ntas|cu[aá]ntos|le agregu[eé]|subtotal|uchuva)/i.test(last)) {
        throw new Error("Inventó producto ante una frase hostil sin pedido.");
      }
    }
  },
  {
    id: "R029",
    name: "quitar_producto_no_busca_variante",
    bootstrapProfile: {
      correo: "$EMAIL",
      ciudad: "$CITY",
      nombre: "Ana"
    },
    steps: [
      ["dame 2 libras de zanahoria", [/(zanahoria|subtotal|le agreg)/i]],
      ["quite la papa", [/(no veo papa|canasta|zanahoria|no tienes papa)/i]]
    ],
    assert(history) {
      const last = String(history[history.length - 1]?.reply || "");
      if (/(opciones reales|cu[aá]l le doy|papa criolla|papa pastusa)/i.test(last)) {
        throw new Error("Interpretó 'quite la papa' como búsqueda/compra de papa.");
      }
    }
  }
];

const criticalList = String(process.env.CRITICAL_SCENARIOS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const activeScenarios = criticalList.length > 0
  ? scenarios.filter((s) => criticalList.includes(s.id))
  : scenarios;

async function runScenario(s) {
  const sid = sessionId(s.name);
  const vars = {
    phone: `3${Math.floor(100000000 + Math.random() * 899999999)}`,
    email: `regresion.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.com`,
    address: "calle 10 #20-30",
    city: "bucaramanga"
  };

  const history = [];
  if (s.bootstrapProfile) {
    const bootstrapProfile = Object.fromEntries(
      Object.entries(s.bootstrapProfile).map(([key, value]) => [key, withVars(String(value), vars)])
    );
    const result = await send(sid, { bootstrapProfile });
    history.push({ user: "[bootstrapProfile]", ...result });
  }

  for (const [rawUser, expected] of s.steps) {
    const user = withVars(rawUser, vars);
    const result = await send(sid, user);
    history.push({ user, ...result });
    if (!includesAny(result.reply, expected)) {
      throw new Error(
        `Respuesta inesperada para "${user}".\nEsperado: ${expected.map((r) => r.toString()).join(" | ")}\nRecibido: ${result.reply}`
      );
    }
  }

  if (typeof s.assert === "function") {
    s.assert(history);
  }
  return history;
}

async function main() {
  const results = [];

  for (const scenario of activeScenarios) {
    try {
      const history = await runScenario(scenario);
      results.push({ id: scenario.id, name: scenario.name, ok: true, history });
    } catch (error) {
      results.push({ id: scenario.id, name: scenario.name, ok: false, error: String(error) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  mkdirSync("docs", { recursive: true });
  const lines = [
    "# Regression Chat Report",
    "",
    `- Fecha: ${NOW}`,
    `- Base URL: ${BASE_URL}`,
    `- Total: ${results.length}`,
    `- OK: ${okCount}`,
    `- FAIL: ${failCount}`,
    ""
  ];

  for (const r of results) {
    lines.push(`## ${r.id} - ${r.name}`);
    lines.push(`Estado: ${r.ok ? "OK" : "FAIL"}`);
    if (r.ok) {
      for (const turn of r.history) {
        lines.push(`- USER: ${turn.user}`);
        lines.push(`- BOT: ${turn.reply}`);
        if (turn.contract) lines.push(`- CONTRACT: ${JSON.stringify(turn.contract)}`);
      }
    } else {
      lines.push(`- Error: ${r.error}`);
    }
    lines.push("");
  }

  writeFileSync(join("docs", "chat-regression-latest.md"), lines.join("\n"), "utf8");

  console.log(`${okCount}/${results.length} OK`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
