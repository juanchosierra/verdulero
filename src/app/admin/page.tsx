"use client";

import { useState, useEffect } from "react";
import {
    TrendingUp,
    MessageSquare,
    ShoppingBasket,
    Search,
    Bell,
    HelpCircle,
    Bot,
    ShieldCheck,
    ArrowUpRight,
    CheckCircle2,
    Zap,
    MoreVertical,
    ChevronRight,
    User,
    ExternalLink,
    ShieldAlert,
    History,
    FileEdit,
    Power,
    Clock,
    ArrowDownRight,
    LayoutGrid,
    Activity,
    Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function AdminDashboard() {
    const [time, setTime] = useState("");
    const [stats, setStats] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const [statsRes, ordersRes] = await Promise.all([
                fetch('/api/admin/stats'),
                fetch('/api/admin/orders')
            ]);
            const statsData = await statsRes.json();
            const ordersData = await ordersRes.json();

            if (!statsData.error) setStats(statsData);
            if (!ordersData.error) setOrders(ordersData.slice(0, 5)); // Just top 5
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
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

    const totals = stats?.totals || { sales: 0, pending: 0, chats: 0, conversion: 0 };

    return (
        <div className="flex-1 min-h-screen bg-[#F1F5F9] flex flex-col font-sans animate-in fade-in duration-500">

            {/* 🟢 Barra Superior Compacta */}
            <header className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <LayoutGrid size={16} className="text-emerald-600" />
                    <h1 className="text-xs font-black text-slate-800 uppercase tracking-widest">Dashboard Operativo</h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[9px] font-black text-emerald-700 uppercase">SAPI ONLINE</span>
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
                            <CompactStatCard label="Ventas Hoy" value={`$${totals.sales.toLocaleString()}`} trend="+12.5%" isPositive={true} />
                            <CompactStatCard label="Chats Activos" value={totals.chats.toString()} trend="+5" isPositive={true} />
                            <CompactStatCard label="Pedidos OK" value={(orders.length - totals.pending).toString()} trend="-2" isPositive={false} />
                            <CompactStatCard label="Conversión" value={`${totals.conversion}%`} trend="+1.2%" isPositive={true} />
                        </section>

                        {/* 🟢 Bloque Central */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            <div className="lg:col-span-8 space-y-4">
                                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden group">
                                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                        <div className="flex items-center gap-2">
                                            <Bot size={14} className="text-emerald-600" />
                                            <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Cerebro AI Operativo</h3>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] font-bold text-slate-400">EFICIENCIA</span>
                                                <span className="text-[10px] font-black text-emerald-600">88%</span>
                                            </div>
                                            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 w-[88%]" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="md:col-span-2 space-y-4">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Carga de Trabajo</p>
                                                    <p className="text-sm font-bold text-slate-800">{totals.chats} Clientes en línea</p>
                                                </div>
                                                <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Status SAPI</p>
                                                    <p className="text-sm font-bold text-emerald-600 uppercase">Sincronizado</p>
                                                </div>
                                            </div>
                                            <Link href="/admin/stats" className="bg-slate-900 border border-slate-800 p-3 rounded-md flex items-center justify-between group cursor-pointer hover:bg-black transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <Activity size={16} className="text-emerald-400 animate-pulse" />
                                                    <p className="text-[11px] font-bold text-white uppercase tracking-widest leading-none">Ver Pulso de Datos e Inteligencia</p>
                                                </div>
                                                <ChevronRight size={14} className="text-white/40 group-hover:translate-x-1 transition-transform" />
                                            </Link>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Link href="/admin/chats" className="flex-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase py-2 rounded-md hover:bg-emerald-100 transition-colors border border-emerald-100 flex items-center justify-center">
                                                Gestionar Chats
                                            </Link>
                                            <Link href="/admin/settings" className="flex-1 bg-white text-slate-600 text-[10px] font-bold uppercase py-2 rounded-md hover:bg-slate-50 transition-colors border border-slate-200 flex items-center justify-center">
                                                Configurar Bot
                                            </Link>
                                            <button className="flex-1 bg-rose-50 text-rose-600 text-[10px] font-bold uppercase py-2 rounded-md hover:bg-rose-100 transition-colors border border-rose-100">
                                                Pausar IA
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Últimos Pedidos Confirmados</h3>
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
                                                        <th className="px-4 py-2">Cliente</th>
                                                        <th className="px-4 py-2">Total</th>
                                                        <th className="px-4 py-2 text-right">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {orders.map(o => (
                                                        <CompactOrderRow
                                                            key={o.id}
                                                            id={o.id}
                                                            name={o.customerName}
                                                            total={`$${o.total.toLocaleString()}`}
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
                                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 overflow-hidden group">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Seguridad del Sistema</h3>
                                        <ShieldCheck size={14} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-[11px]">
                                            <span className="text-slate-400 font-bold uppercase tracking-tighter">Motor de Inferencia</span>
                                            <span className="text-emerald-600 font-bold">ACTIVO</span>
                                        </div>
                                        <div className="flex justify-between text-[11px]">
                                            <span className="text-slate-400 font-bold uppercase tracking-tighter">Estabilidad Base</span>
                                            <span className="text-slate-900 font-bold italic">OPTIMA</span>
                                        </div>
                                        <div className="h-1 bg-slate-100 rounded-full flex gap-0.5 overflow-hidden">
                                            {[...Array(12)].map((_, i) => (
                                                <div key={i} className="flex-1 bg-emerald-500 rounded-full" />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t border-slate-50">
                                        <button className="w-full text-[9px] font-bold uppercase py-2 bg-slate-50 text-slate-500 border border-slate-100 rounded hover:bg-slate-100 transition-colors italic">
                                            Auto-diagnóstico Completo
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-emerald-600 rounded-lg p-4 shadow-lg shadow-emerald-900/10 text-white relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-8 rotate-12 opacity-10 group-hover:scale-125 transition-transform duration-1000">
                                        <Bot size={100} />
                                    </div>
                                    <div className="relative z-10 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Zap size={14} className="text-emerald-200 fill-emerald-200" />
                                            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-100">Optimizador SAPI</p>
                                        </div>
                                        <p className="text-xs font-bold leading-relaxed italic pr-8">
                                            "Sistema operando con eficiencia máxima. No se requieren ajustes manuales."
                                        </p>
                                        <Link href="/admin/settings" className="inline-block text-[9px] font-black uppercase bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded transition-all">
                                            Fuerza Bruta AI
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

function CompactStatCard({ label, value, trend, isPositive }: any) {
    return (
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between hover:border-emerald-300 transition-colors group">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-emerald-500 transition-colors">{label}</p>
            <div className="flex items-end justify-between">
                <p className="text-xl font-black text-slate-800 tracking-tighter leading-none italic">{value}</p>
                <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    isPositive ? "bg-emerald-50 text-emerald-700 font-black" : "bg-rose-50 text-rose-700"
                )}>
                    {trend}
                </span>
            </div>
        </div>
    );
}

function CompactOrderRow({ id, name, total, status, statusClass }: any) {
    return (
        <tr className="hover:bg-slate-50 transition-colors text-[11px] font-bold text-slate-600 border-b border-slate-50/50">
            <td className="px-4 py-3 font-mono text-slate-400 text-[10px]">#{id}</td>
            <td className="px-4 py-3 text-slate-800 uppercase tracking-tighter">{name}</td>
            <td className="px-4 py-3 font-black text-slate-900 italic tracking-tighter">{total}</td>
            <td className="px-4 py-3 text-right">
                <span className={cn("px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter shadow-sm", statusClass)}>
                    {status}
                </span>
            </td>
        </tr>
    );
}
