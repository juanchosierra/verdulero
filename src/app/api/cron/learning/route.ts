import { NextResponse } from "next/server";
import { runLearningAnalysis } from "@/lib/learning";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    try {
        const result = await runLearningAnalysis();
        return NextResponse.json({
            ok: true,
            reportsAnalyzed: result.reportsAnalyzed,
            messagesAnalyzed: result.messagesAnalyzed,
            suggestionsCreated: result.suggestions.length,
            run: result.run
        });
    } catch (error) {
        console.error("Learning cron error:", error);
        return NextResponse.json({ error: "No pude ejecutar el aprendizaje semanal." }, { status: 500 });
    }
}
