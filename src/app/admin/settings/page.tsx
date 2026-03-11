"use client";

import { useState, useEffect } from "react";
import {
    Save,
    Loader2,
    Globe,
    Key,
    User,
    MessageSquare,
    Database,
    History,
    CheckCircle2,
    AlertCircle,
    Clock,
    Settings,
    ShieldCheck,
    Zap,
    Bot
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
    const [config, setConfig] = useState<any>({
        wcUrl: "",
        wcConsumerKey: "",
        wcConsumerSecret: "",
        geminiApiKey: "",
        personalidad: "",
        mensajeBienvenida: "¡Qué tal! Bienvenido a El Verdulero.",
        horaCorte: "14:00",
        emailAdmin: "ventas@elverdulero.com.co",
        intervencionManual: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

    useEffect(() => {
        fetch("/api/admin/config")
            .then(res => res.json())
            .then(data => {
                if (data && !data.error) {
                    setConfig((prev: any) => ({ ...prev, ...data }));
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setStatus("idle");

        try {
            const res = await fetch("/api/admin/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });

            if (res.ok) {
                setStatus("success");
            } else {
                setStatus("error");
            }
        } catch (error) {
            setStatus("error");
        } finally {
            setSaving(false);
            setTimeout(() => setStatus("idle"), 3000);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sincronizando con base de datos...</p>
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-screen bg-[#F8FAFC]/50 flex flex-col font-sans mb-20 animate-in fade-in duration-500">

            {/* 🔴 Header de Ajustes */}
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-900 rounded-lg text-white">
                        <Settings size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Configuración del Sistema</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <Database size={10} /> Base de Datos Conectada
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <AnimatePresence>
                        {status === "success" && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-lg"
                            >
                                <CheckCircle2 size={16} className="text-emerald-600" />
                                <span className="text-[11px] font-black text-emerald-700 uppercase">Cambios guardados</span>
                            </motion.div>
                        )}
                        {status === "error" && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex items-center gap-2 px-4 py-2 bg-rose-50 border border-rose-100 rounded-lg"
                            >
                                <AlertCircle size={16} className="text-rose-600" />
                                <span className="text-[11px] font-black text-rose-700 uppercase">Error al procesar</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="h-10 px-8 bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest rounded-lg shadow-lg shadow-emerald-200 hover:bg-emerald-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {saving ? "Guardando..." : "Guardar en Servidor"}
                    </button>
                </div>
            </header>

            <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
                <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    <SectionCard title="Sincronización WooCommerce" icon={<Globe className="text-blue-500" />} color="blue">
                        <div className="space-y-5">
                            <div>
                                <Label>Endpoint de tu Tienda</Label>
                                <Input
                                    value={config.wcUrl}
                                    placeholder="https://elverdulero.com.co"
                                    onChange={(v: string) => setConfig({ ...config, wcUrl: v })}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-5">
                                <div>
                                    <Label>Consumer Key (CK)</Label>
                                    <Input
                                        type="password"
                                        value={config.wcConsumerKey}
                                        onChange={(v: string) => setConfig({ ...config, wcConsumerKey: v })}
                                    />
                                </div>
                                <div>
                                    <Label>Consumer Secret (CS)</Label>
                                    <Input
                                        type="password"
                                        value={config.wcConsumerSecret}
                                        onChange={(v: string) => setConfig({ ...config, wcConsumerSecret: v })}
                                    />
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard title="Cerebro IA (Google Gemini)" icon={<Key className="text-purple-500" />} color="purple">
                        <div className="space-y-4">
                            <div>
                                <Label>Gemini Pro API Key</Label>
                                <Input
                                    type="password"
                                    value={config.geminiApiKey}
                                    onChange={(v: string) => setConfig({ ...config, geminiApiKey: v })}
                                />
                            </div>
                            <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                                <p className="text-[10px] font-bold text-purple-700 leading-relaxed uppercase">
                                    Este token permite la conexión de baja latencia con el modelo de lenguaje que maneja los chats.
                                </p>
                            </div>
                        </div>
                    </SectionCard>

                    <div className="md:col-span-2">
                        <SectionCard title="Instrucciones del Sistema (🧠 El Cerebro)" icon={<Bot className="text-emerald-500" />} color="emerald">
                            <div className="space-y-6">
                                <div>
                                    <Label>Prompt Maestro (Definición del Personaje)</Label>
                                    <textarea
                                        rows={8}
                                        value={config.personalidad}
                                        onChange={e => setConfig({ ...config, personalidad: e.target.value })}
                                        placeholder="Instrucciones sobre cómo debe responder el robot..."
                                        className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-[13px] font-mono text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-200 transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <Label>Mensaje de Saludo Predeterminado</Label>
                                    <Input
                                        value={config.mensajeBienvenida}
                                        onChange={(v: string) => setConfig({ ...config, mensajeBienvenida: v })}
                                    />
                                </div>
                            </div>
                        </SectionCard>
                    </div>

                    <SectionCard title="Reglas Operativas" icon={<Clock className="text-orange-500" />} color="orange">
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Hora de Corte</Label>
                                    <input
                                        type="time"
                                        value={config.horaCorte || "14:00"}
                                        onChange={e => setConfig({ ...config, horaCorte: e.target.value })}
                                        className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:bg-white transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <Label>Email Notificaciones</Label>
                                    <Input
                                        type="email"
                                        value={config.emailAdmin}
                                        onChange={(v: string) => setConfig({ ...config, emailAdmin: v })}
                                    />
                                </div>
                            </div>
                            <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-colors", config.intervencionManual ? "bg-orange-500 text-white" : "bg-slate-200 text-slate-400")}>
                                        <History size={20} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-800 uppercase tracking-tighter">Intervención Manual</p>
                                        <p className="text-[10px] font-bold text-slate-400">Pausa al robot para chat humano</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setConfig({ ...config, intervencionManual: !config.intervencionManual })}
                                    className={cn(
                                        "w-12 h-6 rounded-full relative transition-colors duration-300 ring-2 ring-white shadow-inner",
                                        config.intervencionManual ? "bg-orange-500" : "bg-slate-300"
                                    )}
                                >
                                    <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300", config.intervencionManual ? "left-7" : "left-1")} />
                                </button>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard title="Seguridad del Sistema" icon={<ShieldCheck className="text-slate-500" />} color="slate">
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-none">Status de Protección</p>
                                <div className="flex items-center gap-2 text-emerald-600">
                                    <Zap size={16} className="fill-current" />
                                    <span className="text-sm font-black uppercase tracking-tight">Cifrado de Extremo a Extremo</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between text-xs py-2 border-b border-slate-100">
                                    <span className="font-bold text-slate-400 uppercase tracking-tighter text-[10px]">Version</span>
                                    <span className="font-mono font-bold text-slate-900 leading-none">v2.4.1 SEC</span>
                                </div>
                                <div className="flex items-center justify-between text-xs py-2">
                                    <span className="font-bold text-slate-400 uppercase tracking-tighter text-[10px]">Base de Datos</span>
                                    <span className="font-mono font-bold text-emerald-600 leading-none">PRISMA CONNECTED</span>
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                </form>

                <div className="mt-12 flex justify-center pb-20">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full max-w-md h-14 bg-slate-900 text-white text-[13px] font-black uppercase tracking-[0.2em] rounded-2xl shadow-2xl shadow-slate-300 hover:scale-[1.03] active:scale-95 transition-all flex items-center justify-center gap-3 group disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={24} className="animate-spin text-emerald-400" /> : <Save size={20} className="text-emerald-400" />}
                        {saving ? "Procesando cambios..." : "Guardar en Base de Datos"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionCard({ title, icon, children, color }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-full group transition-all duration-300 hover:shadow-premium hover:border-slate-300/50">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/30">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-slate-100">
                    {icon}
                </div>
                <h3 className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{title}</h3>
            </div>
            <div className="p-6">
                {children}
            </div>
        </div>
    );
}

function Label({ children }: any) {
    return <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 italic">{children}</label>;
}

function Input({ ...props }: any) {
    return (
        <input
            {...props}
            onChange={e => props.onChange(e.target.value)}
            className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-200 transition-all shadow-sm"
        />
    );
}
