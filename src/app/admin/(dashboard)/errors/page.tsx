"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert, CheckCircle2, Clock3, MessageSquareText } from "lucide-react";

type ErrorReport = {
    id: string;
    sessionId?: string | null;
    messageIndex?: number | null;
    messageRole: string;
    messageContent: string;
    reporterNote?: string | null;
    previousMessage?: string | null;
    nextMessage?: string | null;
    conversationSlice: string;
    pageUrl?: string | null;
    status: string;
    createdAt: string;
};

const STATUS_STYLES: Record<string, string> = {
    nuevo: "border-rose-200 bg-rose-50 text-rose-700",
    revisando: "border-amber-200 bg-amber-50 text-amber-700",
    resuelto: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

export default function AdminErrorsPage() {
    const [reports, setReports] = useState<ErrorReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("abiertos");
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const fetchReports = async () => {
        try {
            const res = await fetch("/api/admin/error-reports");
            const data = await res.json();
            if (!data.error) {
                setReports(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
        const interval = setInterval(fetchReports, 8000);
        return () => clearInterval(interval);
    }, []);

    const visibleReports = useMemo(() => {
        if (filter === "abiertos") return reports.filter((report) => report.status !== "resuelto");
        if (filter === "historial") return reports.filter((report) => report.status === "resuelto");
        if (filter === "todos") return reports;
        return reports.filter((report) => report.status === filter);
    }, [reports, filter]);

    const updateStatus = async (id: string, status: string) => {
        try {
            setUpdatingId(id);
            const res = await fetch("/api/admin/error-reports", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status })
            });
            if (!res.ok) throw new Error("No pude actualizar");
            setReports((prev) => prev.map((report) => report.id === id ? { ...report, status } : report));
        } catch (error) {
            console.error(error);
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-7xl">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-rose-700">Modo inspección</p>
                            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Reportes de error del chat</h1>
                            <p className="mt-2 max-w-2xl text-sm font-semibold leading-relaxed text-slate-500">
                                Aquí vamos a recoger todo lo que el equipo encuentre raro, confuso o roto mientras prueba el flujo real del Verdulero.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {[
                                { value: "abiertos", label: "Abiertos" },
                                { value: "nuevo", label: "Nuevo" },
                                { value: "revisando", label: "Revisando" },
                                { value: "historial", label: "Historial" }
                            ].map((status) => (
                                <button
                                    key={status.value}
                                    type="button"
                                    onClick={() => setFilter(status.value)}
                                    className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] transition ${
                                        filter === status.value
                                            ? "bg-slate-900 text-white"
                                            : "border border-slate-200 bg-white text-slate-500"
                                    }`}
                                >
                                    {status.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-rose-50 p-3 text-rose-700"><ShieldAlert size={18} /></div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Totales</p>
                                <p className="mt-1 text-3xl font-black text-slate-900">{reports.length}</p>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-amber-50 p-3 text-amber-700"><Clock3 size={18} /></div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Pendientes</p>
                                <p className="mt-1 text-3xl font-black text-slate-900">{reports.filter((r) => r.status !== "resuelto").length}</p>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><CheckCircle2 size={18} /></div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Resueltos</p>
                                <p className="mt-1 text-3xl font-black text-slate-900">{reports.filter((r) => r.status === "resuelto").length}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-5 space-y-4">
                    {loading ? (
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-10 text-center shadow-sm">
                            <Loader2 className="mx-auto h-6 w-6 animate-spin text-rose-600" />
                            <p className="mt-3 text-sm font-bold text-slate-500">Cargando reportes...</p>
                        </div>
                    ) : visibleReports.length === 0 ? (
                        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
                            <MessageSquareText className="mx-auto h-8 w-8 text-slate-300" />
                            <p className="mt-4 text-sm font-black text-slate-500">
                                {filter === "historial"
                                    ? "Todavía no hay reportes resueltos en el historial."
                                    : "No hay reportes abiertos en este filtro."}
                            </p>
                        </div>
                    ) : (
                        visibleReports.map((report) => (
                            <div key={report.id} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${STATUS_STYLES[report.status] || STATUS_STYLES.nuevo}`}>
                                                {report.status}
                                            </span>
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                                {report.messageRole === "assistant" ? "Mensaje del bot" : "Mensaje del cliente"}
                                            </span>
                                            <span className="text-[11px] font-bold text-slate-400">
                                                {new Date(report.createdAt).toLocaleString("es-CO")}
                                            </span>
                                        </div>

                                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Mensaje reportado</p>
                                                <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-900">{report.messageContent}</p>
                                            </div>
                                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-700">Descripción del error</p>
                                                <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-rose-900">
                                                    {report.reporterNote || "Sin descripción adicional."}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Contexto del chat</p>
                                            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm font-semibold leading-relaxed text-slate-700">
                                                {report.conversationSlice}
                                            </pre>
                                        </div>
                                    </div>

                                    <div className="flex w-full gap-2 lg:w-auto lg:flex-col">
                                        <button
                                            type="button"
                                            onClick={() => updateStatus(report.id, "revisando")}
                                            disabled={updatingId === report.id}
                                            className="flex-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-amber-700 disabled:opacity-60"
                                        >
                                            Revisando
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => updateStatus(report.id, "resuelto")}
                                            disabled={updatingId === report.id}
                                            className="flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 disabled:opacity-60"
                                        >
                                            Resuelto
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
