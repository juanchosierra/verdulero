"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Loader2, ShieldCheck, ChevronRight, Globe, Sparkles } from "lucide-react";
import Image from "next/image";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const res = await signIn("credentials", {
            email,
            password,
            redirect: false,
        });
        if (res?.ok) {
            router.push("/admin");
        } else {
            alert("Credenciales incorrectas");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-8 relative overflow-hidden font-sans">
            {/* Abstract Background patterns */}
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

            <div className="bg-white/70 backdrop-blur-xl p-12 rounded-[3.5rem] shadow-premium border border-white/50 max-w-xl w-full relative z-10 space-y-10 group hover:shadow-2xl transition-all duration-700 animate-in fade-in zoom-in duration-500">

                <div className="text-center space-y-6">
                    <div className="relative inline-block group/logo">
                        <div className="absolute inset-0 bg-primary/10 rounded-3xl blur-2xl group-hover/logo:blur-3xl transition-all duration-700 opacity-50" />
                        <div className="relative p-4 transition-transform duration-700 group-hover/logo:scale-105">
                            <img
                                src="https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"
                                alt="Logo"
                                className="w-80 mx-auto drop-shadow-xl"
                            />
                        </div>
                        <div className="absolute -bottom-4 -right-4 p-4 bg-primary text-white rounded-3xl shadow-xl shadow-primary/20 scale-0 group-hover/logo:scale-100 transition-transform duration-500 flex items-center justify-center">
                            <Sparkles size={24} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-4xl font-black text-gray-900 tracking-tight leading-none uppercase">Central Operadora</h1>
                        <p className="text-gray-400 font-black text-[11px] uppercase tracking-[0.25em] flex items-center justify-center gap-2">
                            <ShieldCheck size={14} className="text-primary" /> Acceso Restringido • SuperAdmin v1.0
                        </p>
                    </div>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-4">
                        <div className="relative group/input">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/5 to-accent/5 rounded-[2rem] blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                            <div className="relative bg-white border border-gray-100 rounded-[1.8rem] shadow-sm focus-within:shadow-premium focus-within:border-primary/20 transition-all duration-300">
                                <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within/input:text-primary transition-colors" size={20} />
                                <input
                                    type="email"
                                    placeholder="Tu correo administrativo"
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className="w-full pl-16 pr-8 py-5 bg-transparent border-none rounded-[1.8rem] outline-none text-sm font-bold placeholder:text-gray-300"
                                />
                            </div>
                        </div>
                        <div className="relative group/input">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/5 to-accent/5 rounded-[2rem] blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                            <div className="relative bg-white border border-gray-100 rounded-[1.8rem] shadow-sm focus-within:shadow-premium focus-within:border-primary/20 transition-all duration-300">
                                <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within/input:text-primary transition-colors" size={20} />
                                <input
                                    type="password"
                                    placeholder="Tu contraseña maestra"
                                    required
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full pl-16 pr-8 py-5 bg-transparent border-none rounded-[1.8rem] outline-none text-sm font-bold placeholder:text-gray-300"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full group/btn relative overflow-hidden bg-gray-900 text-white py-5 rounded-[1.8rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-gray-900/10 hover:shadow-2xl hover:scale-[1.03] active:scale-95 transition-all duration-500 flex items-center justify-center gap-3"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary-600 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-700 -z-10" />
                        {loading ? <Loader2 className="animate-spin" /> : (
                            <>
                                Entrar al Sistema <ChevronRight size={18} className="group-hover/btn:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>
                </form>

                <div className="pt-6 border-t border-gray-100 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <div className="flex items-center gap-1">
                        <Globe size={12} className="text-primary" /> Multi-Canal Sync
                    </div>
                    <p>© El Verdulero • 2026</p>
                </div>
            </div>
        </div>
    );
}
