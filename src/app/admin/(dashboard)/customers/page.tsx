"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Calendar,
    Heart,
    Loader2,
    Mail,
    MapPin,
    MessageSquare,
    Package,
    Phone,
    Search,
    ShoppingBasket,
    Sparkles,
    UserRound,
    UsersRound,
    X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Customer = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    lastAddress: string | null;
    sources: string[];
    firstContactAt: string | null;
    lastContactAt: string | null;
    lastPurchaseAt: string | null;
    totalOrders: number;
    totalSpent: number;
    averageOrder: number;
    chatCount: number;
    messageCount: number;
    favoriteProducts: Array<{ name: string; quantity: number; times: number; revenue: number; lastOrderedAt: string }>;
    preferences: {
        preferredDay: string | null;
        usualCity: string | null;
        lastAddress: string | null;
    };
    orders: Array<{
        id: number;
        createdAt: string;
        status: string;
        total: number;
        subtotal: number;
        shipping: number;
        customerAddress: string;
        customerCity: string;
        items: any[];
    }>;
    chats: Array<{
        id: string;
        updatedAt: string;
        isActive: boolean;
        messageCount: number;
        lastMessage: string | null;
        messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    }>;
};

function formatCop(value: number) {
    return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

function formatDate(value?: string | null) {
    if (!value) return "Sin registro";
    return new Date(value).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function initials(name: string) {
    const parts = String(name || "Cliente").trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0]).join("").toUpperCase() || "CL";
}

function sourceLabel(customer: Customer) {
    if (customer.totalOrders > 0) return "Compró";
    if (customer.chatCount > 0) return "Conversó";
    return "Contacto";
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"Todos" | "Compraron" | "Conversaron" | "Contactos">("Todos");
    const [selected, setSelected] = useState<Customer | null>(null);

    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                const response = await fetch("/api/admin/customers");
                const data = await response.json();
                if (!data.error) {
                    setCustomers(Array.isArray(data.customers) ? data.customers : []);
                    setSummary(data.summary || null);
                }
            } catch (error) {
                console.error("Customers load error:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchCustomers();
    }, []);

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return customers.filter((customer) => {
            const matchesFilter =
                filter === "Todos" ||
                (filter === "Compraron" && customer.totalOrders > 0) ||
                (filter === "Conversaron" && customer.chatCount > 0) ||
                (filter === "Contactos" && customer.totalOrders === 0);

            const matchesSearch = !needle ||
                customer.name.toLowerCase().includes(needle) ||
                String(customer.phone || "").includes(needle) ||
                String(customer.email || "").toLowerCase().includes(needle) ||
                String(customer.city || "").toLowerCase().includes(needle);

            return matchesFilter && matchesSearch;
        });
    }, [customers, filter, search]);

    return (
        <div className="flex-1 h-screen overflow-hidden bg-slate-50/50 flex flex-col font-sans animate-in fade-in duration-500">
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
                        <UsersRound size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Clientes</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <UserRound size={10} /> {summary?.totalCustomers || 0} registros unificados
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="bg-slate-100 border-none rounded-lg py-2 pl-9 pr-4 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white w-56 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                        {(["Todos", "Compraron", "Conversaron", "Contactos"] as const).map((option) => (
                            <button
                                key={option}
                                onClick={() => setFilter(option)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-tighter transition-all",
                                    filter === option ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Metric label="Contactados" value={summary?.contacted || 0} icon={<Phone size={18} />} />
                    <Metric label="Conversaron" value={summary?.chatted || 0} icon={<MessageSquare size={18} />} />
                    <Metric label="Compraron" value={summary?.buyers || 0} icon={<ShoppingBasket size={18} />} />
                    <Metric label="Facturación clientes" value={formatCop(summary?.totalRevenue || 0)} icon={<Sparkles size={18} />} />
                </section>

                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargando clientes...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-20 text-center space-y-4">
                        <UsersRound className="mx-auto text-slate-200" size={42} />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none">No se encontraron clientes</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-b-4 border-b-emerald-600/10">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-sans">
                                <thead>
                                    <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                        <th className="px-6 py-4">Cliente</th>
                                        <th className="px-6 py-4">Contacto</th>
                                        <th className="px-6 py-4">Actividad</th>
                                        <th className="px-6 py-4">Favoritos</th>
                                        <th className="px-6 py-4 text-right">Valor</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    <AnimatePresence mode="popLayout">
                                        {filtered.map((customer) => (
                                            <motion.tr
                                                key={customer.id}
                                                layout
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.98 }}
                                                className="group hover:bg-slate-50/60 transition-all cursor-pointer"
                                                onClick={() => setSelected(customer)}
                                            >
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-black">
                                                            {initials(customer.name)}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-black text-slate-900 uppercase truncate">{customer.name}</div>
                                                            <div className="mt-1 inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500">
                                                                {sourceLabel(customer)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="space-y-1.5 text-[10px] font-bold text-slate-500">
                                                        <div className="flex items-center gap-1.5"><Phone size={11} className="text-emerald-500" />{customer.phone || "Sin teléfono"}</div>
                                                        <div className="flex items-center gap-1.5"><Mail size={11} className="text-emerald-500" />{customer.email || "Sin correo"}</div>
                                                        <div className="flex items-center gap-1.5 max-w-[220px] truncate"><MapPin size={11} className="text-rose-400 shrink-0" />{customer.city || "Sin ciudad"}</div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <Badge icon={<ShoppingBasket size={10} />} text={`${customer.totalOrders} compra(s)`} />
                                                        <Badge icon={<MessageSquare size={10} />} text={`${customer.messageCount} mensaje(s)`} />
                                                    </div>
                                                    <div className="mt-2 text-[9px] font-bold text-slate-400 uppercase">Último contacto: {formatDate(customer.lastContactAt)}</div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-wrap gap-1.5 max-w-[260px]">
                                                        {customer.favoriteProducts.slice(0, 3).map((product) => (
                                                            <span key={product.name} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[9px] font-black text-slate-600 shadow-sm">
                                                                {product.name}
                                                            </span>
                                                        ))}
                                                        {customer.favoriteProducts.length === 0 && (
                                                            <span className="text-[10px] font-bold text-slate-300 italic">Sin compras todavía</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <div className="text-base font-black text-slate-950 italic tracking-tighter">{formatCop(customer.totalSpent)}</div>
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Prom. {formatCop(customer.averageOrder)}</div>
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

            <AnimatePresence>
                {selected && (
                    <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
                )}
            </AnimatePresence>
        </div>
    );
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
                    <div className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{value}</div>
                </div>
                <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
                    {icon}
                </div>
            </div>
        </div>
    );
}

function Badge({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500">
            {icon}
            {text}
        </span>
    );
}

function CustomerDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-slate-950/40 backdrop-blur-sm p-4 md:p-8"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="ml-auto h-full w-full max-w-4xl overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-2xl flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-sm font-black shadow-lg shadow-emerald-900/10">
                            {initials(customer.name)}
                        </div>
                        <div className="min-w-0">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">Perfil de cliente</div>
                            <h2 className="mt-2 text-2xl font-black text-slate-900 truncate">{customer.name}</h2>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                <span className="inline-flex items-center gap-1.5"><Phone size={14} />{customer.phone || "Sin teléfono"}</span>
                                <span className="inline-flex items-center gap-1.5"><Mail size={14} />{customer.email || "Sin correo"}</span>
                                <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{customer.city || "Sin ciudad"}</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <section className="grid md:grid-cols-4 gap-4">
                        <Metric label="Compras" value={customer.totalOrders} icon={<ShoppingBasket size={18} />} />
                        <Metric label="Total gastado" value={formatCop(customer.totalSpent)} icon={<Sparkles size={18} />} />
                        <Metric label="Conversaciones" value={customer.chatCount} icon={<MessageSquare size={18} />} />
                        <Metric label="Ticket promedio" value={formatCop(customer.averageOrder)} icon={<Package size={18} />} />
                    </section>

                    <section className="grid lg:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Preferencias detectadas</div>
                            <InfoRow label="Día usual de compra" value={customer.preferences.preferredDay || "Sin patrón aún"} />
                            <InfoRow label="Ciudad frecuente" value={customer.preferences.usualCity || "Sin ciudad"} />
                            <InfoRow label="Última dirección" value={customer.preferences.lastAddress || "Sin dirección"} />
                            <InfoRow label="Última compra" value={formatDate(customer.lastPurchaseAt)} />
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700 flex items-center gap-2"><Heart size={13} /> Productos favoritos</div>
                            {customer.favoriteProducts.length === 0 ? (
                                <p className="text-sm font-bold text-emerald-800/60">Todavía no hay compras para detectar favoritos.</p>
                            ) : customer.favoriteProducts.map((product) => (
                                <div key={product.name} className="flex items-center justify-between gap-4 rounded-xl bg-white/80 border border-emerald-100 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-black text-slate-900 truncate">{product.name}</div>
                                        <div className="text-[10px] font-bold text-slate-500">{product.times} vez/veces · {Number(product.quantity || 0).toLocaleString("es-CO")} acumulado</div>
                                    </div>
                                    <div className="text-sm font-black text-emerald-700">{formatCop(product.revenue)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Historial de compras</div>
                        {customer.orders.length === 0 ? (
                            <EmptyLine text="Este cliente no tiene pedidos registrados todavía." />
                        ) : customer.orders.map((order) => (
                            <div key={order.id} className="rounded-2xl border border-slate-200 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="text-sm font-black text-slate-900">Pedido #{order.id}</div>
                                        <div className="mt-1 text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5"><Calendar size={11} />{formatDate(order.createdAt)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-lg font-black text-emerald-700">{formatCop(order.total)}</div>
                                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{order.status}</div>
                                    </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {order.items.map((item: any, index: number) => (
                                        <span key={`${order.id}-${index}`} className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[9px] font-black text-slate-600">
                                            {item.quantity} {item.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>

                    <section className="space-y-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Historial de conversaciones</div>
                        {customer.chats.length === 0 ? (
                            <EmptyLine text="Este cliente no tiene chats registrados." />
                        ) : customer.chats.map((chat) => (
                            <div key={chat.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="text-sm font-black text-slate-900">{chat.messageCount} mensaje(s)</div>
                                    <div className="text-[10px] font-bold text-slate-400">{formatDate(chat.updatedAt)}</div>
                                </div>
                                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                                    {chat.messages.slice(-16).map((message) => (
                                        <div
                                            key={message.id}
                                            className={cn(
                                                "rounded-2xl px-3 py-2 text-xs leading-relaxed border",
                                                message.role === "user"
                                                    ? "bg-slate-900 text-white border-slate-900 ml-10"
                                                    : "bg-slate-50 text-slate-700 border-slate-200 mr-10"
                                            )}
                                        >
                                            <div className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">{message.role === "user" ? "Cliente" : "Verdulero"}</div>
                                            {message.content}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                </div>
            </motion.div>
        </motion.div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-2 last:border-0 last:pb-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
            <span className="text-sm font-bold text-slate-700 text-right">{value}</span>
        </div>
    );
}

function EmptyLine({ text }: { text: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-xs font-black uppercase tracking-widest text-slate-300">
            {text}
        </div>
    );
}
