"use client";

import { useState, useEffect } from "react";
import {
    MessageSquare,
    ShoppingBasket,
    Bot,
    ShieldCheck,
    CheckCircle2,
    ChevronRight,
    User,
    History,
    Clock,
    LayoutGrid,
    Loader2,
    AlertCircle,
    Mail
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { buildDeliverySchedule, DEFAULT_CUTOFF } from "@/lib/delivery";

function bogotaDateKey(dateLike: string | Date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(dateLike));
}

export default function AdminDashboard() {
    const [time, setTime] = useState("");
    const [stats, setStats] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [intervencion, setIntervencion] = useState(false);
    const [togglingIA, setTogglingIA] = useState(false);
    const [horaCorte, setHoraCorte] = useState(DEFAULT_CUTOFF);

    const fetchData = async () => {
        try {
            const [statsRes, ordersRes, configRes] = await Promise.all([
                fetch('/api/admin/stats'),
                fetch('/api/admin/orders'),
                fetch('/api/admin/config')
            ]);
            const statsData = await statsRes.json();
            const ordersData = await ordersRes.json();
            const configData = await configRes.json();
            const todayKey = bogotaDateKey(new Date());

            if (!statsData.error) setStats(statsData);
            if (!ordersData.error) {
                const todaysOrders = (Array.isArray(ordersData) ? ordersData : [])
                    .filter((order) => order?.createdAt && bogotaDateKey(order.createdAt) === todayKey)
                    .slice(0, 8);
                setOrders(todaysOrders);
            }
            if (!configData.error) {
                setIntervencion(configData.intervencionManual);
                if (typeof configData.horaCorte === "string" && configData.horaCorte) {
                    setHoraCorte(configData.horaCorte);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleIA = async () => {
        const newVal = !intervencion;
        setTogglingIA(true);
        setIntervencion(newVal);
        try {
            await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intervencionManual: newVal })
            });
        } catch (e) {
            setIntervencion(!newVal);
        } finally {
            setTogglingIA(false);
        }
    };

    useEffect(() => {
        fetchData();
        const updateTime = () => {
            const now = new Date();
            setTime(now.toLocaleString('es-CO', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }));
        };
        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, []);

    const totals = stats?.totals || { salesToday: 0, sales: 0, pending: 0, chats: 0, conversion: 0, orders: 0 };
    const deliverySchedule = buildDeliverySchedule(horaCorte, new Date());
    const reportInfo = stats?.reports || {};
    const realKpis = [
        { label: "Ventas hoy", value: `$${(totals.salesToday || 0).toLocaleString()}` },
        { label: "Chats activos", value: `${totals.chats || 0}` },
        { label: "Pedidos totales", value: `${totals.orders || 0}` },
        { label: "Conversión", value: `${totals.conversion || 0}%` }
    ];
    const checks = [
        {
            label: "IA atendiendo",
            ok: !intervencion,
            detail: intervencion ? "Intervención manual activa." : "La IA está activa en este momento."
        },
        {
            label: "Horario configurado",
            ok: Boolean(horaCorte),
            detail: `Hora de corte: ${horaCorte}`
        },
        {
            label: "Reportes configurados",
            ok: Boolean(reportInfo.recipientsCount),
            detail: reportInfo.recipientsCount ? `${reportInfo.recipientsCount} destinatario(s) configurados.` : "Aún no hay correos configurados."
        }
    ];

    return (
        <div className="flex-1 min-h-screen bg-[#F1F5F9] flex flex-col font-sans animate-in fade-in duration-500">

            {/* 🟢 Barra Superior Compacta */}
            <header className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <LayoutGrid size={16} className="text-emerald-600" />
                    <h1 className="text-xs font-black text-slate-800 uppercase tracking-widest">Dashboard Operativo</h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className={cn(
                        "px-2 py-0.5 rounded border flex items-center gap-2",
                        intervencion ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100"
                    )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", intervencion ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
                        <span className={cn("text-[9px] font-black uppercase", intervencion ? "text-amber-700" : "text-emerald-700")}>
                            {intervencion ? "IA PAUSADA" : "IA ACTIVA"}
                        </span>
                    </div>
                    <div className="h-4 w-[1px] bg-slate-200" />
                    <div className="flex items-center gap-3">
                        <p className="text-[11px] font-mono font-bold text-slate-500">{time}</p>
                        <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                            <User size={14} />
                        </div>
                    </div>
                </div>
            </header>

            <main className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto w-full">

                {loading ? (
                    <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sincronizando Plataforma...</p>
                    </div>
                ) : (
                    <>
                        {/* 🟢 KPIs en Fila */}
                        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {realKpis.map((item) => (
                                <CompactStatCard key={item.label} label={item.label} value={item.value} />
                            ))}
                        </section>

                        {/* 🟢 Bloque Central */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            <div className="lg:col-span-8 space-y-4">
                                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden group">
                                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                        <div className="flex items-center gap-2">
                                            <Bot size={14} className="text-emerald-600" />
                                            <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Estado operativo real</h3>
                                        </div>
                                    </div>

                                    <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="md:col-span-2 space-y-4">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Chats activos</p>
                                                    <p className="text-sm font-bold text-slate-800">{totals.chats} conversación(es)</p>
                                                </div>
                                                <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Pedidos pendientes</p>
                                                    <p className="text-sm font-bold text-slate-800">{totals.pending} pedido(s)</p>
                                                </div>
                                            </div>
                                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Próxima entrega visible al cliente</p>
                                                <p className="text-sm font-bold text-slate-900">{deliverySchedule.fullWindowLabel}</p>
                                                <p className="mt-1 text-[11px] font-semibold text-slate-500">{deliverySchedule.countdownLabel}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Link href="/admin/chats" className="flex-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase py-2 rounded-md hover:bg-emerald-100 transition-colors border border-emerald-100 flex items-center justify-center">
                                                Gestionar Chats
                                            </Link>
                                            <Link href="/admin/settings" className="flex-1 bg-white text-slate-600 text-[10px] font-bold uppercase py-2 rounded-md hover:bg-slate-50 transition-colors border border-slate-200 flex items-center justify-center">
                                                Configurar Bot
                                            </Link>
                                            <button
                                                onClick={handleToggleIA}
                                                disabled={togglingIA}
                                                className={cn(
                                                    "flex-1 text-[10px] font-bold uppercase py-2 rounded-md transition-colors border disabled:opacity-60",
                                                    intervencion
                                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100"
                                                        : "bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100"
                                                )}
                                            >
                                                {intervencion ? "Reactivar IA" : "Pausar IA"}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Pedidos de hoy</h3>
                                        <Link href="/admin/orders" className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase">Ver todos</Link>
                                    </div>
                                    <div className="overflow-x-auto">
                                        {orders.length === 0 ? (
                                            <div className="p-8 text-center text-[10px] font-bold text-slate-400 uppercase">Sin pedidos registrados hoy</div>
                                        ) : (
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="bg-slate-50 text-[9px] font-bold text-slate-400 uppercase border-b border-slate-100">
                                                        <th className="px-4 py-2">ID</th>
                                                        <th className="px-4 py-2 text-right">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {orders.map(o => (
                                                        <CompactOrderRow
                                                            key={o.id}
                                                            id={o.id}
                                                            status={o.status === 'Pendiente' ? 'PEN' : o.status === 'En Camino' ? 'ENV' : 'OK'}
                                                            statusClass={o.status === 'Pendiente' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}
                                                        />
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="lg:col-span-4 space-y-4">
                                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 overflow-hidden">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Operación de pedidos</h3>
                                        <Clock size={14} className="text-emerald-500" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Hora de corte</p>
                                            <p className="mt-1 text-sm font-black text-slate-900">{horaCorte}</p>
                                        </div>
                                        <div className={cn(
                                            "rounded-md border p-3",
                                            deliverySchedule.isOpen ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"
                                        )}>
                                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Estado</p>
                                            <p className={cn("mt-1 text-sm font-black", deliverySchedule.isOpen ? "text-emerald-700" : "text-amber-700")}>
                                                {deliverySchedule.isOpen ? "Recibiendo pedidos" : "Corte cerrado"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-lime-100 bg-lime-50 p-3">
                                        <p className="text-[9px] font-black uppercase tracking-wider text-lime-700">Próxima entrega visible al cliente</p>
                                        <p className="mt-1 text-sm font-black text-lime-950">{deliverySchedule.fullWindowLabel}</p>
                                        <p className="mt-1 text-[11px] font-semibold text-lime-700">{deliverySchedule.countdownLabel}</p>
                                    </div>
                                    <Link href="/admin/settings" className="flex w-full items-center justify-center rounded-md border border-slate-200 bg-slate-50 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 transition-colors hover:bg-slate-100">
                                        Programar horario del bot
                                    </Link>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 overflow-hidden group">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Chequeos reales del sistema</h3>
                                        <ShieldCheck size={14} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                                    </div>
                                    <div className="space-y-3">
                                        {checks.map((check) => (
                                            <div key={check.label} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">{check.label}</span>
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                                                        check.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                                                    )}>
                                                        {check.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                                                        {check.ok ? "OK" : "REVISAR"}
                                                    </span>
                                                </div>
                                                <p className="mt-2 text-[11px] font-semibold text-slate-500">{check.detail}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="pt-2 border-t border-slate-50">
                                        <Link href="/admin/errors" className="w-full text-[9px] font-bold uppercase py-2 bg-slate-50 text-slate-500 border border-slate-100 rounded hover:bg-slate-100 transition-colors italic flex items-center justify-center">
                                            Revisar errores reportados
                                        </Link>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4">
                                    <div className="flex items-center gap-2">
                                        <Mail size={14} className="text-emerald-600" />
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Reportes de ventas</h3>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold text-slate-900">{reportInfo.enabled ? "Programados" : "Desactivados"}</p>
                                        <p className="text-[11px] font-semibold text-slate-500">
                                            Hora: {reportInfo.hour || "18:00"} · Destinatarios: {reportInfo.recipientsCount || 0}
                                        </p>
                                        <p className="text-[11px] font-semibold text-slate-500">
                                            Último envío: {reportInfo.lastDispatch?.period || "Todavía no hay envíos"}
                                        </p>
                                    </div>
                                    <Link href="/admin/stats" className="flex w-full items-center justify-center rounded-md border border-emerald-100 bg-emerald-50 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-100">
                                        Configurar reportes PDF
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

function CompactStatCard({ label, value }: any) {
    return (
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between hover:border-emerald-300 transition-colors group">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-emerald-500 transition-colors">{label}</p>
            <div className="flex items-end justify-between">
                <p className="text-xl font-black text-slate-800 tracking-tighter leading-none italic">{value}</p>
            </div>
        </div>
    );
}

function CompactOrderRow({ id, status, statusClass }: any) {
    return (
        <tr className="hover:bg-slate-50 transition-colors text-[11px] font-bold text-slate-600 border-b border-slate-50/50">
            <td className="px-4 py-3 font-mono text-slate-400 text-[10px]">#{id}</td>
            <td className="px-4 py-3 text-right">
                <span className={cn("px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter shadow-sm", statusClass)}>
                    {status}
                </span>
            </td>
        </tr>
    );
}
