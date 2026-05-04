"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import {
    LayoutDashboard,
    ShoppingCart,
    MessageSquare,
    BarChart2,
    Settings,
    LogOut,
    User,
    ShieldAlert,
    BrainCircuit,
    PackageSearch,
    MessagesSquare,
    Boxes,
    Menu,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";

const menuItems = [
    { icon: LayoutDashboard, label: "Resumen", href: "/admin" },
    { icon: ShoppingCart, label: "Pedidos", href: "/admin/orders" },
    { icon: PackageSearch, label: "Productos", href: "/admin/products" },
    { icon: Boxes, label: "Inventario", href: "/admin/inventory" },
    { icon: MessagesSquare, label: "Atención WhatsApp", href: "/admin/whatsapp" },
    { icon: MessageSquare, label: "Chats", href: "/admin/chats" },
    { icon: ShieldAlert, label: "Errores", href: "/admin/errors" },
    { icon: BrainCircuit, label: "Aprendizaje", href: "/admin/learning" },
    { icon: BarChart2, label: "Reportes", href: "/admin/stats" },
    { icon: Settings, label: "Ajustes", href: "/admin/settings" },
];

export default function AdminSidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [desktopCollapsed, setDesktopCollapsed] = useState(false);

    const close = () => setMobileOpen(false);

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem("verdulero-admin-sidebar-collapsed");
            setDesktopCollapsed(saved === "1");
        } catch {}
    }, []);

    const toggleDesktop = () => {
        setDesktopCollapsed((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem("verdulero-admin-sidebar-collapsed", next ? "1" : "0");
            } catch {}
            return next;
        });
    };

    return (
        <>
            {/* ── Botón hamburguesa (solo móvil) ── */}
            <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden fixed top-4 left-4 z-50 p-2.5 bg-slate-900 text-white rounded-xl shadow-xl border border-white/10"
                aria-label="Abrir menú"
            >
                <Menu size={20} />
            </button>

            {/* ── Backdrop (solo móvil cuando está abierto) ── */}
            {mobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
                    onClick={close}
                />
            )}

            {/* ── Sidebar ── */}
            <aside className={cn(
                "min-h-screen bg-slate-900 flex flex-col shrink-0 font-sans z-50 text-white/70 border-r border-white/5",
                // En móvil: overlay fijo que entra/sale con transición
                "fixed md:relative top-0 left-0 h-full",
                "transition-transform duration-300 ease-in-out",
                desktopCollapsed ? "md:w-[84px]" : "md:w-60",
                "w-60",
                mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            )}>

                <button
                    onClick={toggleDesktop}
                    className="hidden md:flex absolute -right-3 top-6 z-10 h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg"
                    aria-label={desktopCollapsed ? "Expandir barra lateral" : "Ocultar barra lateral"}
                >
                    {desktopCollapsed ? <Menu size={14} /> : <X size={14} />}
                </button>

                {/* Botón cerrar (solo móvil) */}
                <button
                    onClick={close}
                    className="md:hidden absolute top-4 right-4 p-1.5 text-white/30 hover:text-white transition-colors"
                    aria-label="Cerrar menú"
                >
                    <X size={18} />
                </button>

                {/* Logo */}
                <div className={cn("mb-4", desktopCollapsed ? "px-3 py-6" : "p-8")}>
                    <Link
                        href="/admin"
                        onClick={close}
                        className="block transform hover:scale-[1.05] transition-transform duration-500"
                    >
                        <div className="p-1 rounded-2xl transition-transform duration-300">
                            <img
                                src="https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"
                                alt="El Verdulero"
                                className="w-full h-auto object-contain"
                            />
                        </div>
                    </Link>
                    {!desktopCollapsed && (
                        <div className="mt-5 flex items-center justify-center px-3 py-1 bg-white/5 rounded-lg border border-white/5">
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-none">Panel de Control</p>
                        </div>
                    )}
                </div>

                {/* Menú */}
                <nav className="flex-1 px-4 space-y-1.5 focus:outline-none">
                    {!desktopCollapsed && (
                        <p className="px-3 text-[9px] font-black text-white/20 uppercase tracking-[0.25em] mb-4">Módulos de Gestión</p>
                    )}
                    {menuItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={close}
                                className={cn(
                                    "flex items-center rounded-xl text-[13px] transition-all duration-300 font-bold group",
                                    desktopCollapsed ? "justify-center px-0 py-3" : "justify-between px-4 py-3",
                                    isActive
                                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 ring-1 ring-white/10"
                                        : "text-white/40 hover:bg-white/5 hover:text-white"
                                )}
                                title={item.label}
                            >
                                <div className="flex items-center gap-3">
                                    <item.icon size={18} className={cn(isActive ? "text-white" : "text-white/20 group-hover:text-emerald-400")} strokeWidth={2.5} />
                                    {!desktopCollapsed && (
                                        <span className="tracking-tight uppercase text-[11px]">{item.label}</span>
                                    )}
                                </div>
                                {isActive && !desktopCollapsed && (
                                    <div className="bg-white/20 p-1 rounded-md">
                                        <div className="w-1 h-1 bg-white rounded-full" />
                                    </div>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-white/5 bg-black/30">
                    <div className={cn("bg-white/5 rounded-2xl border border-white/5 mb-4 group hover:bg-white/[0.08] transition-all cursor-default", desktopCollapsed ? "p-3" : "p-4")}>
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-900/40 group-hover:scale-110 transition-transform">
                                <User size={18} strokeWidth={3} />
                            </div>
                            {!desktopCollapsed && (
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black text-white truncate leading-none uppercase tracking-wide">{session?.user?.name || "Admin"}</p>
                                    <p className="text-[9px] font-medium text-emerald-400 mt-1.5 flex items-center gap-1 uppercase">
                                        <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_5px_green]" /> En Línea
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => signOut({ callbackUrl: '/admin/login' })}
                        className={cn(
                            "flex items-center justify-center gap-2 w-full rounded-xl text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-rose-400 hover:bg-rose-400/10 transition-all duration-300 border border-white/5",
                            desktopCollapsed ? "py-3 px-0" : "py-4"
                        )}
                        title="Cerrar sesión"
                    >
                        <LogOut size={16} className="rotate-180" />
                        {!desktopCollapsed && "Cerrar Sesión"}
                    </button>
                </div>
            </aside>
        </>
    );
}
