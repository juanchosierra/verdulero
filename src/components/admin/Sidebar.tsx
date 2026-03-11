"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
    LayoutDashboard,
    ShoppingCart,
    MessageSquare,
    BarChart2,
    Settings,
    LogOut,
    User,
    Zap,
    Globe
} from "lucide-react";
import { cn } from "@/lib/utils";

const menuItems = [
    { icon: LayoutDashboard, label: "Resumen", href: "/admin" },
    { icon: ShoppingCart, label: "Pedidos", href: "/admin/orders" },
    { icon: MessageSquare, label: "Chats", href: "/admin/chats" },
    { icon: BarChart2, label: "Reportes", href: "/admin/stats" },
    { icon: Settings, label: "Ajustes", href: "/admin/settings" },
];

export default function AdminSidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-60 min-h-screen bg-slate-900 flex flex-col shrink-0 font-sans z-50 text-white/70 border-r border-white/5">
            {/* 🔴 Nuevo contenedor de Logo - Integrado y visible */}
            <div className="p-8 mb-4">
                <Link href="/admin" className="block transform hover:scale-[1.05] transition-transform duration-500">
                    <div className="p-1 rounded-2xl transition-transform duration-300">
                        <img
                            src="https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"
                            alt="El Verdulero"
                            className="w-full h-auto object-contain"
                        />
                    </div>
                </Link>
                <div className="mt-5 flex items-center justify-center px-3 py-1 bg-white/5 rounded-lg border border-white/5">
                    <p className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-none">Panel de Control</p>
                </div>
            </div>

            {/* 🔴 Menú Compacto y Premium */}
            <nav className="flex-1 px-4 space-y-1.5 focus:outline-none">
                <p className="px-3 text-[9px] font-black text-white/20 uppercase tracking-[0.25em] mb-4">Módulos de Gestión</p>
                {menuItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center justify-between px-4 py-3 rounded-xl text-[13px] transition-all duration-300 font-bold group",
                                isActive
                                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 ring-1 ring-white/10"
                                    : "text-white/40 hover:bg-white/5 hover:text-white"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <item.icon size={18} className={cn(isActive ? "text-white" : "text-white/20 group-hover:text-emerald-400")} strokeWidth={2.5} />
                                <span className="tracking-tight uppercase text-[11px]">{item.label}</span>
                            </div>
                            {isActive && (
                                <div className="bg-white/20 p-1 rounded-md">
                                    <div className="w-1 h-1 bg-white rounded-full" />
                                </div>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* 🔴 Pie de página - Super Profesional */}
            <div className="p-4 border-t border-white/5 bg-black/30">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 mb-4 group hover:bg-white/[0.08] transition-all cursor-default">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-900/40 group-hover:scale-110 transition-transform">
                            <User size={18} strokeWidth={3} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] font-black text-white truncate leading-none uppercase tracking-wide">Super Admin</p>
                            <p className="text-[9px] font-medium text-emerald-400 mt-1.5 flex items-center gap-1 uppercase">
                                <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_5px_green]" /> En Línea
                            </p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => signOut({ callbackUrl: '/admin/login' })}
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-rose-400 hover:bg-rose-400/10 transition-all duration-300 border border-white/5"
                >
                    <LogOut size={16} className="rotate-180" />
                    Cerrar Sesión
                </button>
            </div>
        </aside>
    );
}
