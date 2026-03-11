"use client";

import { useState, useEffect } from 'react';
import {
    BarChart2,
    TrendingUp,
    ShoppingBasket,
    MessageSquare,
    ArrowUpRight,
    ArrowDownRight,
    Zap,
    Clock,
    Bot,
    ShieldCheck,
    Package,
    Loader2,
    Calendar,
    MoreVertical,
    ChevronRight,
    TrendingDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from "framer-motion";

export default function ReportsPage() {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/admin/stats')
            .then(res => res.json())
            .then(data => {
                if (!data.error) setStats(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Calculando KPIs operativos...</p>
            </div>
        );
    }

    const totals = stats?.totals || { sales: 0, pending: 0, chats: 0, conversion: 0 };
    const chart = stats?.chart || [];

    return (
        <div className="flex-1 min-h-screen bg-[#F8FAFC]/50 flex flex-col font-sans mb-20 animate-in fade-in duration-500 overflow-x-hidden">

            {/* 🔴 Header de Reportes */}
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-900 rounded-lg text-white">
                        <BarChart2 size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Inteligencia de Negocio</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <Calendar size={10} /> {new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_green]" />
                        <span className="text-[10px] font-black text-emerald-700 uppercase">SAPI LIVE DATA</span>
                    </div>
                </div>
            </header>

            <main className="p-6 md:p-8 max-w-6xl mx-auto w-full space-y-8">

                {/* Row 1: Key Performance Indicators */}
                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatMiniCard label="Ventas Totales" value={`$${totals.sales.toLocaleString()}`} icon={<ShoppingBasket className="text-emerald-600" />} trend="+15%" isPositive={true} />
                    <StatMiniCard label="Conversión" value={`${totals.conversion}%`} icon={<TrendingUp className="text-blue-600" />} trend="+2.4%" isPositive={true} />
                    <StatMiniCard label="Chats Activos" value={totals.chats.toString()} icon={<MessageSquare className="text-purple-600" />} trend="+8" isPositive={true} />
                    <StatMiniCard label="Ratio de Fallas" value="0.2%" icon={<ShieldCheck className="text-orange-600" />} trend="-1.1%" isPositive={true} />
                </section>

                {/* Row 2: Charts and Deeper Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                    {/* Main Chart Card */}
                    <div className="lg:col-span-8 bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-premium relative overflow-hidden group">
                        <div className="flex items-center justify-between mb-12">
                            <div>
                                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest italic">Tendencia Semanal de Despacho</h3>
                                <p className="text-xs font-bold text-slate-400 uppercase mt-1">Ventas vs Proyecciones</p>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-bold text-slate-400 uppercase">
                                    7 DIAS <ChevronRight size={14} />
                                </div>
                            </div>
                        </div>

                        <div className="h-64 flex items-end justify-between gap-4 px-4">
                            {chart.map((d: any, i: number) => {
                                const height = (d.sales / 500000) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-4 group/bar h-full justify-end">
                                        <div className="w-full relative h-[100%] flex flex-col justify-end">
                                            <motion.div
                                                initial={{ height: 0 }}
                                                animate={{ height: `${height}%` }}
                                                transition={{ duration: 1, delay: i * 0.1 }}
                                                className={cn(
                                                    "w-full rounded-t-xl transition-all duration-500 bg-gradient-to-t relative",
                                                    i === chart.length - 1
                                                        ? "from-emerald-600 to-emerald-400 group-hover/bar:brightness-110"
                                                        : "from-slate-100 to-slate-50 group-hover/bar:from-emerald-100 group-hover/bar:to-emerald-50"
                                                )}
                                            >
                                                {i === chart.length - 1 && (
                                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-black px-2 py-1 rounded-md shadow-xl opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap">
                                                        HOY: ${d.sales.toLocaleString()}
                                                    </div>
                                                )}
                                            </motion.div>
                                        </div>
                                        <span className="text-[10px] font-black text-slate-300 uppercase italic leading-none">{d.day}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Efficiency Pulse Card */}
                    <div className="lg:col-span-4 bg-slate-900 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-emerald-900/10 relative overflow-hidden flex flex-col group border border-slate-800">
                        <div className="absolute top-0 right-0 p-12 opacity-[0.05] rotate-12 group-hover:scale-125 transition-transform duration-1000">
                            <Bot size={250} />
                        </div>

                        <div className="relative z-10 flex flex-col h-full">
                            <div className="flex items-center gap-2 mb-8">
                                <Zap size={18} className="text-emerald-400 fill-emerald-400" />
                                <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-400 italic">Pulso del Algoritmo</h3>
                            </div>

                            <div className="space-y-10 flex-1">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-end">
                                        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Autonomía IA</span>
                                        <span className="text-2xl font-black italic tracking-tighter">75%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                        <motion.div initial={{ width: 0 }} animate={{ width: "75%" }} transition={{ duration: 2 }} className="h-full bg-emerald-500" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6 pt-4">
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <p className="text-[9px] font-bold text-white/30 uppercase mb-2">Pedidos asistidos</p>
                                        <p className="text-xl font-black italic">148</p>
                                    </div>
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <p className="text-[9px] font-bold text-white/30 uppercase mb-2">Chats finalizados</p>
                                        <p className="text-xl font-black italic">622</p>
                                    </div>
                                </div>
                            </div>

                            <button className="mt-12 w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all active:scale-95 group/btn">
                                Optimizar Cerebro IA <ChevronRight size={14} className="inline ml-2 group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </div>

                </div>

                {/* Row 3: Operational Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-20">
                    <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-premium flex flex-col gap-8 group">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100">
                                <ShieldCheck size={24} />
                            </div>
                            <div>
                                <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest italic leading-none">Status de SAPI</h4>
                                <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-tighter">Conexión con WooCommerce</p>
                            </div>
                        </div>
                        <p className="text-xs font-bold text-slate-500 leading-relaxed italic border-l-4 border-slate-100 pl-4 py-1">
                            "Sistema de sincronización en tiempo real operando sin cuellos de botella. Uptime del 99.98% hoy."
                        </p>
                        <div className="mt-2 flex gap-4">
                            <div className="px-4 py-2 bg-slate-50 rounded-xl text-[10px] font-black text-slate-500 uppercase border border-slate-100 shadow-sm transition-all group-hover:bg-white group-hover:shadow-md">SSL: ACTIVO</div>
                            <div className="px-4 py-2 bg-slate-50 rounded-xl text-[10px] font-black text-slate-500 uppercase border border-slate-100 shadow-sm transition-all group-hover:bg-white group-hover:shadow-md">API CACHE: HIT (85%)</div>
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-premium flex flex-col gap-8 group">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-100">
                                <Zap size={24} />
                            </div>
                            <div>
                                <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest italic leading-none">Intervención Humana</h4>
                                <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-tighter">Override Activo del Sistema</p>
                            </div>
                        </div>
                        <p className="text-xs font-bold text-slate-500 leading-relaxed italic border-l-4 border-slate-100 pl-4 py-1">
                            "Se han registrado 4 intervenciones manuales en la última hora. El motor de aprendizaje está auditando estas ventas."
                        </p>
                        <div className="mt-2">
                            <button className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2 group/audit">
                                AUDITAR INTERVENCIONES <ChevronRight size={14} className="group-hover/audit:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </div>
                </div>

            </main>
        </div>
    );
}

function StatMiniCard({ label, value, icon, trend, isPositive }: any) {
    return (
        <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-premium flex flex-col gap-6 group hover:-translate-y-2 transition-all duration-300">
            <div className="flex items-center justify-between">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-emerald-50 group-hover:text-emerald-600 group-hover:border-emerald-100 transition-all shadow-sm">
                    {icon}
                </div>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-200 hover:text-slate-900 transition-colors">
                    <MoreVertical size={18} />
                </div>
            </div>
            <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none italic">{label}</p>
                <div className="flex items-end justify-between">
                    <h3 className="text-3xl font-black text-slate-900 tracking-tighter italic leading-none">{value}</h3>
                    <div className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border shadow-sm",
                        isPositive ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100"
                    )}>
                        {trend} {isPositive ? <ArrowUpRight size={14} strokeWidth={3} /> : <TrendingDown size={14} strokeWidth={3} />}
                    </div>
                </div>
            </div>
        </div>
    );
}
