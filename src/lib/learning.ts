import { prisma } from "@/lib/prisma";

type LearningSuggestion = {
    rule: string;
    notes: string;
    source: string;
    sampleCount: number;
};

type ErrorLearningReport = {
    id?: string;
    messageContent: string;
    reporterNote: string | null;
    conversationSlice: string;
};

function normalizeText(raw: string) {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
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

function buildConversationDrivenSuggestions(messages: Array<{ content: string }>) {
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

    for (const message of messages) {
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
            select: { content: true }
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

    const created = await upsertLearningSuggestions(finalSuggestions);

    const summary = `Analicé ${reports.length} reportes y ${messages.length} mensajes. Generé ${finalSuggestions.length} reglas sugeridas.`;
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
        JSON.stringify({ topRules: finalSuggestions.slice(0, 10) }),
        reports.length,
        messages.length,
        finalSuggestions.length
    );
    const run = runRows[0];

    return {
        run,
        reportsAnalyzed: reports.length,
        messagesAnalyzed: messages.length,
        suggestions: finalSuggestions
    };
}
