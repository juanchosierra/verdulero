"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Loader2, Sparkles, CheckCircle2, Ban, RefreshCcw, MessageCircle, PackageSearch, AlertTriangle, HelpCircle, ShoppingBasket } from "lucide-react";

type LearnedRule = {
    id: string;
    rule: string;
    status: string;
    source?: string | null;
    notes?: string | null;
    sampleCount: number;
    createdAt: string;
    updatedAt: string;
};

type LearningRun = {
    id: string;
    summary: string;
    reportsAnalyzed: number;
    messagesAnalyzed: number;
    suggestionsCreated: number;
    findings?: unknown;
    createdAt: string;
};

type InsightBucket = {
    label: string;
    count: number;
    samples: string[];
};

type LearningInsights = {
    generatedAt: string;
    products: InsightBucket[];
    complaints: InsightBucket[];
    questions: InsightBucket[];
    intents: InsightBucket[];
    notFound: InsightBucket[];
    checkoutSignals: InsightBucket[];
    privacy?: string;
};

const STATUS_STYLES: Record<string, string> = {
    suggested: "border-amber-200 bg-amber-50 text-amber-700",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    disabled: "border-slate-200 bg-slate-100 text-slate-600"
};

export default function AdminLearningPage() {
    const [rules, setRules] = useState<LearnedRule[]>([]);
    const [runs, setRuns] = useState<LearningRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [insights, setInsights] = useState<LearningInsights | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setErrorMessage(null);
            const res = await fetch("/api/admin/learning");
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || "No pude cargar aprendizaje.");
            if (!data.error) {
                setRules(Array.isArray(data.rules) ? data.rules : []);
                setRuns(Array.isArray(data.runs) ? data.runs : []);
                setInsights(data.insights || null);
            }
        } catch (error) {
            console.error(error);
            setErrorMessage(error instanceof Error ? error.message : "No pude cargar aprendizaje.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const stats = useMemo(() => ({
        suggested: rules.filter((rule) => rule.status === "suggested").length,
        approved: rules.filter((rule) => rule.status === "approved").length,
        disabled: rules.filter((rule) => rule.status === "disabled").length
    }), [rules]);

    const runLearning = async () => {
        try {
            setRunning(true);
            setErrorMessage(null);
            setStatusMessage(null);
            const res = await fetch("/api/admin/learning", { method: "POST" });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || "No pude correr el aprendizaje.");
            setRules(Array.isArray(data.rules) ? data.rules : []);
            setRuns(Array.isArray(data.runs) ? data.runs : []);
            setInsights(data.insights || null);
            setStatusMessage(`Aprendizaje ejecutado: ${data.messagesAnalyzed || 0} mensajes, ${data.reportsAnalyzed || 0} reportes y ${data.suggestionsCreated || 0} reglas revisadas.`);
        } catch (error) {
            console.error(error);
            setErrorMessage(error instanceof Error ? error.message : "No pude correr el aprendizaje.");
        } finally {
            setRunning(false);
        }
    };

    const updateRule = async (id: string, status: string) => {
        try {
            setUpdatingId(id);
            setErrorMessage(null);
            setStatusMessage(null);
            const res = await fetch("/api/admin/learning", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status })
            });
            const updated = await res.json();
            if (!res.ok || updated.error) throw new Error(updated.error || "No pude actualizar la regla.");
            setRules((prev) => prev.map((rule) => rule.id === id ? updated : rule));
            setStatusMessage(status === "approved" ? "Regla aprobada. Ya entra al prompt del chat en la próxima respuesta." : "Regla desactivada. Ya no se usa como regla aprobada.");
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error instanceof Error ? error.message : "No pude actualizar la regla.");
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto flex max-w-7xl flex-col">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">Cerebro operativo</p>
                            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Centro de aprendizaje</h1>
                            <p className="mt-2 max-w-3xl text-sm font-semibold leading-relaxed text-slate-500">
                                Aquí vamos viendo qué patrones reales detecta el sistema, qué reglas nuevas propone y cuáles aprobamos para que el chat mejore sin improvisar.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={runLearning}
                            disabled={running}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:opacity-60"
                        >
                            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                            Ejecutar aprendizaje
                        </button>
                    </div>

                    {(statusMessage || errorMessage) && (
                        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${errorMessage ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                            {errorMessage || statusMessage}
                        </div>
                    )}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <MiniStat icon={<Sparkles size={18} />} label="Sugeridas" value={stats.suggested} tone="amber" />
                    <MiniStat icon={<CheckCircle2 size={18} />} label="Aprobadas" value={stats.approved} tone="emerald" />
                    <MiniStat icon={<Ban size={18} />} label="Desactivadas" value={stats.disabled} tone="slate" />
                </div>

                <section className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">Insights de conversaciones</p>
                            <h2 className="mt-2 text-xl font-black text-slate-900">Qué están pidiendo, preguntando y reportando</h2>
                        </div>
                        {insights?.generatedAt && (
                            <p className="text-[11px] font-bold text-slate-400">
                                Actualizado {new Date(insights.generatedAt).toLocaleString("es-CO")}
                            </p>
                        )}
                    </div>

                    {insights ? (
                        <>
                            <div className="mt-5 grid gap-4 lg:grid-cols-3">
                                <InsightCard icon={<PackageSearch size={18} />} title="Productos mencionados" items={insights.products} />
                                <InsightCard icon={<AlertTriangle size={18} />} title="Quejas y fricciones" items={insights.complaints} />
                                <InsightCard icon={<HelpCircle size={18} />} title="Preguntas frecuentes" items={insights.questions} />
                                <InsightCard icon={<MessageCircle size={18} />} title="Intenciones detectadas" items={insights.intents} />
                                <InsightCard icon={<PackageSearch size={18} />} title="No encontrados" items={insights.notFound} />
                                <InsightCard icon={<ShoppingBasket size={18} />} title="Señales de cierre" items={insights.checkoutSignals} />
                            </div>
                            {insights.privacy && (
                                <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                                    {insights.privacy}
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                            <BrainCircuit className="mx-auto h-7 w-7 text-slate-300" />
                            <p className="mt-3 text-sm font-black text-slate-500">Ejecuta aprendizaje para generar el primer tablero de conversaciones.</p>
                        </div>
                    )}
                </section>

                <div className="mt-5 grid min-h-0 flex-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                    <section className="min-h-0 space-y-4 overflow-hidden">
                        {loading ? (
                            <div className="rounded-[2rem] border border-slate-200 bg-white p-10 text-center shadow-sm">
                                <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
                                <p className="mt-3 text-sm font-bold text-slate-500">Cargando reglas aprendidas...</p>
                            </div>
                        ) : rules.length === 0 ? (
                            <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
                                <BrainCircuit className="mx-auto h-8 w-8 text-slate-300" />
                                <p className="mt-4 text-sm font-black text-slate-500">Todavía no hay reglas aprendidas. Corre el aprendizaje y te las dejo aquí.</p>
                            </div>
                        ) : (
                            <div className="max-h-full space-y-4 overflow-y-auto pr-1">
                            {rules.map((rule) => (
                                <div key={rule.id} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${STATUS_STYLES[rule.status] || STATUS_STYLES.suggested}`}>
                                                    {rule.status}
                                                </span>
                                                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                                    {rule.source || "aprendizaje"}
                                                </span>
                                                <span className="text-[11px] font-bold text-slate-400">
                                                    {rule.sampleCount} muestra{rule.sampleCount === 1 ? "" : "s"}
                                                </span>
                                            </div>

                                            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Regla propuesta</p>
                                                <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-900">{rule.rule}</p>
                                            </div>

                                            {rule.notes ? (
                                                <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Notas / evidencia</p>
                                                    <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap pr-2 font-sans text-sm font-semibold leading-relaxed text-slate-700">
                                                        {rule.notes}
                                                    </pre>
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="flex w-full gap-2 lg:w-auto lg:flex-col">
                                            {rule.status === "approved" ? (
                                                <div className="flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                                                    Activa
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => updateRule(rule.id, "approved")}
                                                    disabled={updatingId === rule.id}
                                                    className="flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                                                >
                                                    {rule.status === "disabled" ? "Reactivar" : "Aprobar"}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => updateRule(rule.id, "disabled")}
                                                disabled={updatingId === rule.id || rule.status === "disabled"}
                                                className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
                                            >
                                                {rule.status === "disabled" ? "Desactivada" : "Desactivar"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            </div>
                        )}
                    </section>

                    <section className="min-h-0 space-y-4 overflow-hidden">
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Log de avances</p>
                            <h2 className="mt-2 text-xl font-black text-slate-900">Corridas de aprendizaje</h2>
                            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                                Cada corrida resume cuántos reportes y mensajes leímos, y cuántas reglas nuevas salieron de ahí.
                            </p>
                        </div>

                        {runs.length === 0 ? (
                            <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm">
                                <p className="text-sm font-black text-slate-500">Aún no hay corridas registradas.</p>
                            </div>
                        ) : (
                            <div className="max-h-full space-y-4 overflow-y-auto pr-1">
                            {runs.map((run) => (
                                <div key={run.id} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                                                {new Date(run.createdAt).toLocaleString("es-CO")}
                                            </p>
                                            <p className="mt-2 text-sm font-black leading-relaxed text-slate-900">{run.summary}</p>
                                        </div>
                                        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                                            <BrainCircuit size={18} />
                                        </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-3 gap-3">
                                        <Metric label="Reportes" value={run.reportsAnalyzed} />
                                        <Metric label="Mensajes" value={run.messagesAnalyzed} />
                                        <Metric label="Reglas" value={run.suggestionsCreated} />
                                    </div>
                                </div>
                            ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "amber" | "emerald" | "slate" }) {
    const toneMap = {
        amber: "bg-amber-50 text-amber-700",
        emerald: "bg-emerald-50 text-emerald-700",
        slate: "bg-slate-100 text-slate-600"
    };
    return (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
                <div className={`rounded-2xl p-3 ${toneMap[tone]}`}>{icon}</div>
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
                    <p className="mt-1 text-3xl font-black text-slate-900">{value}</p>
                </div>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-black text-slate-900">{value}</p>
        </div>
    );
}

function InsightCard({ icon, title, items }: { icon: ReactNode; title: string; items: InsightBucket[] }) {
    return (
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-3 text-emerald-700 shadow-sm">{icon}</div>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">{title}</p>
            </div>
            {items.length === 0 ? (
                <p className="mt-4 text-sm font-semibold text-slate-400">Sin señales todavía.</p>
            ) : (
                <div className="mt-4 space-y-3">
                    {items.slice(0, 5).map((item) => (
                        <div key={item.label} className="rounded-2xl bg-white p-3 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-black text-slate-900">{item.label}</p>
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">{item.count}</span>
                            </div>
                            {item.samples?.[0] && (
                                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-500">
                                    {item.samples[0]}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
