import { prisma } from "@/lib/prisma";

type LearningSuggestion = {
    rule: string;
    notes: string;
    source: string;
    sampleCount: number;
};

type ConversationMessage = {
    role?: string;
    content: string;
};

type InsightBucket = {
    label: string;
    count: number;
    samples: string[];
};

type ErrorLearningReport = {
    id?: string;
    messageContent: string;
    reporterNote: string | null;
    conversationSlice: string;
};

const PRODUCT_HINTS = [
    "aguacate", "tomate", "papa", "cebolla", "zanahoria", "limon", "cilantro", "perejil",
    "pimenton", "lechuga", "pepino", "banano", "manzana", "mango", "pina", "fresa",
    "uva", "zumo", "jugo", "guacas", "acelga", "ahuyama", "arracacha", "yuca",
    "platano", "brocoli", "coliflor", "champinon", "apio", "ajo"
];

const INTENT_PATTERNS: Array<[string, RegExp]> = [
    ["pedido", /\b(dame|deme|quiero|necesito|agrega|agregue|anotame|ponme|llevar)\b/],
    ["precio", /\b(cuanto vale|precio|a como|valor)\b/],
    ["inventario", /\b(tiene|hay|maneja|venden|que.*tienen|que.*hay|opciones)\b/],
    ["cierre", /\b(nada mas|no mas|finalizar|confirmar pedido|eso es todo|ya termine|listo)\b/],
    ["correccion", /\b(cambia|cambie|corrige|no ese|quita|elimina|saque)\b/],
    ["seguimiento", /\b(donde va|mi pedido|estado|tracking|seguimiento)\b/]
];

function normalizeText(raw: string) {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function redactSensitiveText(raw: string) {
    return raw
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[correo]")
        .replace(/\b3\d{9}\b/g, "[telefono]")
        .replace(/\b(?:calle|carrera|cra|cll|avenida|av|diagonal|transversal)\s+[^,\n]{3,80}/gi, "[direccion]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

function bumpInsight(map: Map<string, InsightBucket>, label: string, sample: string) {
    const key = normalizeText(label);
    const safeSample = redactSensitiveText(sample);
    const existing = map.get(key);
    if (existing) {
        existing.count += 1;
        if (safeSample && existing.samples.length < 5 && !existing.samples.includes(safeSample)) {
            existing.samples.push(safeSample);
        }
        return;
    }
    map.set(key, {
        label,
        count: 1,
        samples: safeSample ? [safeSample] : []
    });
}

function topBuckets(map: Map<string, InsightBucket>, limit = 8) {
    return Array.from(map.values())
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, limit);
}

function extractQuotedTerms(text: string) {
    const matches = Array.from(text.matchAll(/["“”']([^"“”']{2,80})["“”']/g));
    return matches.map((match) => match[1].trim()).filter(Boolean);
}

function createRuleHash(rule: string) {
    let hash = 0;
    for (let i = 0; i < rule.length; i += 1) {
        hash = (hash << 5) - hash + rule.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function buildErrorDrivenSuggestions(reports: ErrorLearningReport[]) {
    const suggestions = new Map<string, LearningSuggestion>();

    const add = (rule: string, notes: string, source: string, increment = 1) => {
        const key = createRuleHash(rule);
        const existing = suggestions.get(key);
        if (existing) {
            existing.sampleCount += increment;
            existing.notes = `${existing.notes}\n- ${notes}`;
            return;
        }
        suggestions.set(key, {
            rule,
            notes: `- ${notes}`,
            source,
            sampleCount: increment
        });
    };

    for (const report of reports) {
        const blob = normalizeText(
            [report.messageContent, report.reporterNote || "", report.conversationSlice].join(" ")
        );
        const terms = extractQuotedTerms(`${report.messageContent} ${report.reporterNote || ""}`);

        if (/plural|singular|aguacates|cebollas|zanahorias|tomates|limones/.test(blob)) {
            add(
                "Cuando el cliente use plurales comunes de productos, conviértelos al singular base antes de buscar en catálogo, pero mantén la cantidad intacta.",
                `Reporte de plural/singular en mensaje: ${report.messageContent.slice(0, 120)}`,
                "error_reports"
            );
        }

        if (/\b(k|kg|kilo|kilos|lb|lbs|libra|libras|und|unidad|unidades|atado|rama|ramas)\b/.test(blob)) {
            add(
                "Reconoce sinónimos de unidades y abreviaturas del habla real: k/kg/kilo, lb/libra/libras, und/unidad, rama/ramas/atado.",
                `Reporte por unidad o medida: ${report.messageContent.slice(0, 120)}`,
                "error_reports"
            );
        }

        if (/variante|oro miel|perolera|chonto|cherry|pastusa|criolla/.test(blob)) {
            add(
                "Si un producto tiene variantes y el cliente responde solo con la variante, úsala para resolver el pendiente actual antes de interpretar un producto nuevo.",
                `Reporte de variante pendiente: ${report.messageContent.slice(0, 120)}`,
                "error_reports"
            );
        }

        if (/varios productos|pedido multiple|pedido múltiple|varios en un mensaje|solo proceso uno|solo procesa uno/.test(blob)) {
            add(
                "Cuando el cliente pida varios productos en un solo mensaje, separa cada línea de pedido y no abandones los demás ítems por una sola aclaración pendiente.",
                `Reporte de pedido múltiple: ${report.messageContent.slice(0, 120)}`,
                "error_reports"
            );
        }

        if (/no tengo|no encontre|no encontr[ée]|disponible/.test(blob) && terms.length > 0) {
            add(
                "Antes de responder que un producto no existe, verifica de nuevo el catálogo sincronizado y prueba singular, plural, alias y sustitución permitida.",
                `Reporte de falso no disponible: ${terms.join(", ")}`,
                "error_reports"
            );
        }

        if (/pregunta|que frutas|que verduras|inventario|que tienen|que manejan/.test(blob)) {
            add(
                "Si el cliente pregunta por categorías del inventario, responde listando productos reales de esa categoría en lugar de buscar la frase completa como un producto.",
                `Reporte de pregunta de inventario: ${report.messageContent.slice(0, 120)}`,
                "error_reports"
            );
        }
    }

    return Array.from(suggestions.values());
}

async function upsertLearningSuggestions(suggestions: LearningSuggestion[]) {
    let created = 0;
    for (const suggestion of suggestions) {
        const id = createRuleHash(suggestion.rule);
        await prisma.$executeRawUnsafe(
            `INSERT INTO "LearnedRule" ("id", "rule", "status", "source", "notes", "sampleCount", "createdAt", "updatedAt")
             VALUES ($1, $2, 'suggested', $3, $4, $5, NOW(), NOW())
             ON CONFLICT ("id")
             DO UPDATE SET
               "notes" = EXCLUDED."notes",
               "source" = EXCLUDED."source",
               "sampleCount" = GREATEST("LearnedRule"."sampleCount", EXCLUDED."sampleCount"),
               "updatedAt" = NOW()`,
            id,
            suggestion.rule,
            suggestion.source,
            suggestion.notes,
            suggestion.sampleCount
        );
        created += 1;
    }
    return created;
}

export async function learnFromResolvedErrorReport(report: ErrorLearningReport) {
    const suggestions = buildErrorDrivenSuggestions([report]);
    if (!suggestions.length) {
        return {
            suggestionsCreated: 0,
            suggestions: [] as LearningSuggestion[],
            run: null
        };
    }

    await upsertLearningSuggestions(suggestions);

    const summary = `Aprendizaje automático desde reporte resuelto${report.id ? ` ${report.id}` : ""}. Generé ${suggestions.length} regla(s) sugerida(s).`;
    const runRows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        summary: string;
        findings: unknown;
        reportsAnalyzed: number;
        messagesAnalyzed: number;
        suggestionsCreated: number;
        createdAt: Date;
    }>>(
        `INSERT INTO "LearningRun" ("id", "summary", "findings", "reportsAnalyzed", "messagesAnalyzed", "suggestionsCreated", "createdAt")
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
         RETURNING "id", "summary", "findings", "reportsAnalyzed", "messagesAnalyzed", "suggestionsCreated", "createdAt"`,
        `lr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        summary,
        JSON.stringify({ trigger: "resolved_error_report", reportId: report.id || null, topRules: suggestions }),
        1,
        0,
        suggestions.length
    );

    return {
        suggestionsCreated: suggestions.length,
        suggestions,
        run: runRows[0] || null
    };
}

function buildConversationDrivenSuggestions(messages: ConversationMessage[]) {
    const suggestions = new Map<string, LearningSuggestion>();

    const add = (rule: string, notes: string, source: string) => {
        const key = createRuleHash(rule);
        const existing = suggestions.get(key);
        if (existing) {
            existing.sampleCount += 1;
            existing.notes = `${existing.notes}\n- ${notes}`;
            return;
        }
        suggestions.set(key, { rule, notes: `- ${notes}`, source, sampleCount: 1 });
    };

    for (const message of messages.filter((item) => item.role !== "assistant")) {
        const content = normalizeText(message.content);
        if (/\b(si|sí),\b/.test(content)) {
            add(
                "Si el mensaje empieza con 'sí' pero luego trae una pregunta o producto, no trates 'sí' como parte del nombre del producto.",
                `Mensaje observado: ${message.content.slice(0, 120)}`,
                "messages"
            );
        }

        if (/\bgracias\b|\blisto\b|\bnada mas\b|\bnada más\b/.test(content)) {
            add(
                "Cuando el cliente cierre con 'gracias', 'listo', 'nada más' o similares, no reinicies la venta; cierra o agradece según el estado actual.",
                `Cierre observado: ${message.content.slice(0, 120)}`,
                "messages"
            );
        }
    }

    return Array.from(suggestions.values());
}

function buildConversationInsights(messages: ConversationMessage[], reports: ErrorLearningReport[]) {
    const products = new Map<string, InsightBucket>();
    const complaints = new Map<string, InsightBucket>();
    const questions = new Map<string, InsightBucket>();
    const intents = new Map<string, InsightBucket>();
    const notFound = new Map<string, InsightBucket>();
    const checkoutSignals = new Map<string, InsightBucket>();

    for (const message of messages) {
        const normalized = normalizeText(message.content);
        const isUser = message.role !== "assistant";

        if (isUser) {
            for (const product of PRODUCT_HINTS) {
                const pattern = new RegExp(`\\b${product}\\w*\\b`, "i");
                if (pattern.test(normalized)) {
                    bumpInsight(products, product, message.content);
                }
            }

            for (const [intent, pattern] of INTENT_PATTERNS) {
                if (pattern.test(normalized)) {
                    bumpInsight(intents, intent, message.content);
                }
            }

            if (/\?|\b(que|cuanto|cual|cuales|como|donde|cuando)\b/.test(normalized)) {
                const label = /envio|domicilio/.test(normalized)
                    ? "preguntas sobre envío"
                    : /precio|cuanto|valor/.test(normalized)
                        ? "preguntas de precio"
                        : /hay|tiene|maneja|opciones/.test(normalized)
                            ? "preguntas de inventario"
                            : "otras preguntas";
                bumpInsight(questions, label, message.content);
            }

            if (/no entiende|mal|error|terrible|remal|malo|da rabia|por dios|no sirve|enredo|confunde|no puedo|no deja/.test(normalized)) {
                const label = /no entiende|confunde|enredo/.test(normalized)
                    ? "el bot no entiende"
                    : /no puedo|no deja|boton|click|movil|scroll/.test(normalized)
                        ? "fricción de interfaz"
                        : "queja general";
                bumpInsight(complaints, label, message.content);
            }

            if (/nada mas|no mas|finalizar|confirmar|listo|eso es todo/.test(normalized)) {
                bumpInsight(checkoutSignals, "intención de cierre", message.content);
            }
        } else if (/no encontr[ée]|no tengo|no manejo|no aparece|no existe/.test(normalized)) {
            const compact = message.content
                .replace(/no encontr[ée]|no tengo|no manejo|no aparece|no existe/gi, "")
                .replace(/[":.]/g, " ")
                .trim();
            bumpInsight(notFound, compact.slice(0, 48) || "producto no encontrado", message.content);
        }
    }

    for (const report of reports) {
        const blob = `${report.messageContent} ${report.reporterNote || ""}`;
        const normalized = normalizeText(blob);
        if (/no entiende|mal|error|equivoc|confund|movil|boton|scroll/.test(normalized)) {
            bumpInsight(complaints, "reporte manual de problema", blob);
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        products: topBuckets(products, 10),
        complaints: topBuckets(complaints, 8),
        questions: topBuckets(questions, 8),
        intents: topBuckets(intents, 8),
        notFound: topBuckets(notFound, 8),
        checkoutSignals: topBuckets(checkoutSignals, 6),
        privacy: "Muestras redactadas: correos, teléfonos y direcciones se ocultan en el tablero."
    };
}

export async function loadApprovedLearnedRules() {
    const rules = await prisma.$queryRawUnsafe<Array<{ rule: string }>>(
        'SELECT "rule" FROM "LearnedRule" WHERE "status" = $1 ORDER BY "sampleCount" DESC, "createdAt" DESC LIMIT 40',
        "approved"
    );
    return rules.map((rule: { rule: string }) => rule.rule);
}

export async function runLearningAnalysis() {
    const [reports, messages] = await Promise.all([
        prisma.errorReport.findMany({
            where: { status: "resuelto" },
            orderBy: { createdAt: "desc" },
            take: 500
        }),
        prisma.message.findMany({
            orderBy: { createdAt: "desc" },
            take: 1000,
            select: { role: true, content: true }
        })
    ]);

    const suggestions = [
        ...buildErrorDrivenSuggestions(reports),
        ...buildConversationDrivenSuggestions(messages)
    ];

    const merged = new Map<string, LearningSuggestion>();
    for (const suggestion of suggestions) {
        const key = createRuleHash(suggestion.rule);
        const existing = merged.get(key);
        if (existing) {
            existing.sampleCount += suggestion.sampleCount;
            existing.notes = `${existing.notes}\n${suggestion.notes}`;
        } else {
            merged.set(key, { ...suggestion });
        }
    }

    const finalSuggestions = Array.from(merged.values())
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .slice(0, 25);
    const insights = buildConversationInsights(messages, reports);

    const created = await upsertLearningSuggestions(finalSuggestions);

    const summary = `Analicé ${reports.length} reportes y ${messages.length} mensajes. Generé ${finalSuggestions.length} reglas sugeridas y actualicé el tablero de insights.`;
    const runRows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        summary: string;
        findings: unknown;
        reportsAnalyzed: number;
        messagesAnalyzed: number;
        suggestionsCreated: number;
        createdAt: Date;
    }>>(
        `INSERT INTO "LearningRun" ("id", "summary", "findings", "reportsAnalyzed", "messagesAnalyzed", "suggestionsCreated", "createdAt")
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
         RETURNING "id", "summary", "findings", "reportsAnalyzed", "messagesAnalyzed", "suggestionsCreated", "createdAt"`,
        `lr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        summary,
        JSON.stringify({ topRules: finalSuggestions.slice(0, 10), insights }),
        reports.length,
        messages.length,
        finalSuggestions.length
    );
    const run = runRows[0];

    return {
        run,
        reportsAnalyzed: reports.length,
        messagesAnalyzed: messages.length,
        suggestions: finalSuggestions,
        insights
    };
}
