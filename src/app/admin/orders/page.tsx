"use client";

import { useState, useEffect } from 'react';
import {
    ShoppingBasket,
    Phone,
    MapPin,
    Printer,
    CheckCircle,
    Clock,
    Search,
    Filter,
    ChevronRight,
    MoreVertical,
    Calendar,
    Package,
    ArrowRight,
    ChevronDown,
    Loader2,
    Trash2,
    Truck,
    Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from "framer-motion";

export default function OrdersPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('Todos');
    const [search, setSearch] = useState('');

    const fetchOrders = async () => {
        try {
            const res = await fetch('/api/admin/orders');
            const data = await res.json();
            if (!data.error) {
                // Parse items string to array if needed
                const parsedData = data.map((o: any) => ({
                    ...o,
                    items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
                }));
                setOrders(parsedData);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const updateStatus = async (id: number, status: string) => {
        try {
            const res = await fetch('/api/admin/orders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            });
            if (res.ok) {
                fetchOrders(); // Refresh
            }
        } catch (e) {
            console.error(e);
        }
    };

    const filteredOrders = orders.filter(o => {
        const matchesFilter = filter === 'Todos' || o.status === filter;
        const matchesSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) ||
            o.id.toString().includes(search);
        return matchesFilter && matchesSearch;
    });

    return (
        <div className="flex-1 min-h-screen bg-slate-50/50 flex flex-col font-sans mb-20 animate-in fade-in duration-500">

            {/* 🟢 Header de Ventas - Compacto */}
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
                        <ShoppingBasket size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Gestión de Ventas</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <Package size={10} /> {orders.length} pedidos hoy
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Buscar pedido..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bg-slate-100 border-none rounded-lg py-2 pl-9 pr-4 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white w-48 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                        {['Todos', 'Pendiente', 'En Camino', 'Completado'].map(t => (
                            <button
                                key={t}
                                onClick={() => setFilter(t)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-tighter transition-all",
                                    filter === t ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="p-6 md:p-8 max-w-7xl mx-auto w-full">
                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargando despacho...</p>
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-20 text-center space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                            <Package size={32} />
                        </div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none">No se encontraron pedidos</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-b-4 border-b-emerald-600/10">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left order-collapse font-sans">
                                <thead>
                                    <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                        <th className="px-6 py-4">Ref & ID</th>
                                        <th className="px-6 py-4">Cliente & Destino</th>
                                        <th className="px-6 py-4">Productos</th>
                                        <th className="px-6 py-4">Total</th>
                                        <th className="px-6 py-4 text-right">Acciones de Flujo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    <AnimatePresence mode='popLayout'>
                                        {filteredOrders.map((order) => (
                                            <motion.tr
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                key={order.id}
                                                className="group hover:bg-slate-50/50 transition-all duration-300"
                                            >
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-sm font-black text-slate-900 tracking-tight">#{order.id}</span>
                                                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 bg-slate-100 w-fit px-2 py-0.5 rounded border border-slate-200">
                                                            <Calendar size={10} /> {new Date(order.createdAt).toLocaleDateString('es-CO')}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-col gap-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black text-slate-800 tracking-tight leading-none uppercase">{order.customerName}</span>
                                                            <a href={`https://wa.me/${order.customerPhone}`} target="_blank" className="p-1 hover:bg-emerald-50 rounded transition-colors group/wa">
                                                                <Phone size={10} className="text-emerald-500 group-hover/wa:scale-110" />
                                                            </a>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 italic max-w-[200px] truncate">
                                                            <MapPin size={10} className="text-rose-400 flex-shrink-0" />
                                                            {order.customerAddress}, {order.customerCity}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex -space-x-1.5">
                                                        {order.items.slice(0, 3).map((it: any, i: number) => (
                                                            <div key={i} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-[9px] font-black text-emerald-700 shadow-sm ring-2 ring-white" title={it.name}>
                                                                {it.quantity}
                                                            </div>
                                                        ))}
                                                        {order.items.length > 3 && (
                                                            <div className="w-6 h-6 rounded-md bg-emerald-600 border border-emerald-500 flex items-center justify-center text-[8px] font-black text-white shadow-sm ring-2 ring-white">
                                                                +{order.items.length - 3}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 font-black text-slate-950 text-base italic tracking-tighter">
                                                    ${order.total.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center justify-end gap-3">
                                                        <div className={cn(
                                                            "px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-widest border shadow-sm",
                                                            order.status === 'Pendiente' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                                                order.status === 'En Camino' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                                    'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                        )}>
                                                            {order.status}
                                                        </div>
                                                        <div className="flex gap-1">
                                                            {order.status === 'Pendiente' && (
                                                                <button
                                                                    onClick={() => updateStatus(order.id, 'En Camino')}
                                                                    className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/10"
                                                                    title="Despachar"
                                                                >
                                                                    <Truck size={12} />
                                                                </button>
                                                            )}
                                                            {order.status === 'En Camino' && (
                                                                <button
                                                                    onClick={() => updateStatus(order.id, 'Completado')}
                                                                    className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/10"
                                                                    title="Finalizar"
                                                                >
                                                                    <Check size={12} />
                                                                </button>
                                                            )}
                                                            <button className="p-1.5 bg-slate-100 text-slate-400 rounded hover:bg-slate-200 transition-all border border-slate-200">
                                                                <Printer size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
