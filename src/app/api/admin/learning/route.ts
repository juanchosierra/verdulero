import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { runLearningAnalysis } from "@/lib/learning";

const VALID_RULE_STATUSES = ["suggested", "approved", "disabled"];

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const [rules, runs] = await Promise.all([
            prisma.learnedRule.findMany({
                orderBy: [
                    { status: 'asc' },
                    { sampleCount: 'desc' },
                    { createdAt: 'desc' }
                ]
            }),
            prisma.learningRun.findMany({
                take: 20,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    summary: true,
                    reportsAnalyzed: true,
                    messagesAnalyzed: true,
                    suggestionsCreated: true,
                    findings: true,
                    createdAt: true
                }
            })
        ]);

        const latestInsights = (runs[0]?.findings as any)?.insights || null;

        return NextResponse.json({ rules, runs, insights: latestInsights });
    } catch (error) {
        console.error("Learning GET error:", error);
        return NextResponse.json({ error: "No pude cargar el centro de aprendizaje." }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const result = await runLearningAnalysis();
        return NextResponse.json({
            ok: true,
            run: result.run,
            reportsAnalyzed: result.reportsAnalyzed,
            messagesAnalyzed: result.messagesAnalyzed,
            suggestionsCreated: result.suggestions.length,
            insights: result.insights
        });
    } catch (error) {
        console.error("Learning POST error:", error);
        return NextResponse.json({ error: "No pude ejecutar el aprendizaje ahora mismo." }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { id, status, notes } = await req.json();
        if (!id || !status || !VALID_RULE_STATUSES.includes(status)) {
            return NextResponse.json({ error: "Datos inválidos para actualizar la regla." }, { status: 400 });
        }

        const rule = await prisma.learnedRule.update({
            where: { id },
            data: {
                status,
                notes: typeof notes === "string" ? notes.slice(0, 4000) : undefined,
                updatedAt: new Date()
            }
        });

        return NextResponse.json(rule);
    } catch (error) {
        console.error("Learning PATCH error:", error);
        return NextResponse.json({ error: "No pude actualizar la regla aprendida." }, { status: 500 });
    }
}
