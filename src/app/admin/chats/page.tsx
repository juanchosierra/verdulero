"use client";

import { useState, useEffect, useRef } from 'react';
import {
    Send,
    User,
    UserCheck,
    Search,
    Loader2,
    MessageSquare,
    Bot,
    Clock,
    Phone,
    ChevronRight,
    ShieldAlert,
    Zap,
    MoreVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from "framer-motion";

export default function ChatsAdminPage() {
    const [sessions, setSessions] = useState<any[]>([]);
    const [selectedSession, setSelectedSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [intervencionGlobal, setIntervencionGlobal] = useState(false);
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/admin/chats');
            const data = await res.json();
            if (!data.error) {
                setSessions(data);
                if (selectedSession) {
                    const updated = data.find((s: any) => s.id === selectedSession.id);
                    if (updated) setSelectedSession(updated);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/admin/config');
            const data = await res.json();
            if (!data.error) {
                setIntervencionGlobal(data.intervencionManual);
            }
        } catch (e) { }
    };

    useEffect(() => {
        fetchSessions();
        fetchConfig();
        const interval = setInterval(fetchSessions, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, [selectedSession?.id]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [selectedSession?.messages]);

    const handleToggleIntervencion = async () => {
        const newVal = !intervencionGlobal;
        try {
            setIntervencionGlobal(newVal);
            await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intervencionManual: newVal })
            });
        } catch (e) {
            setIntervencionGlobal(!newVal);
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !selectedSession || sending) return;

        setSending(true);
        const content = input;
        setInput("");

        try {
            await fetch('/api/admin/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: selectedSession.id, content })
            });
            fetchSessions();
        } catch (e) {
            console.error(e);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-1 h-[calc(100vh-120px)] bg-slate-50/50 p-4 gap-4 font-sans animate-in fade-in duration-500 overflow-hidden">

            {/* 🔴 Sidebar de Conversaciones */}
            <div className="w-80 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden shrink-0">
                <header className="p-4 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Canales Activos</h2>
                        <div className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">LIVE</div>
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={14} />
                        <input
                            placeholder="Buscar cliente..."
                            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/10 placeholder:text-slate-300 transition-all"
                        />
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                    {loading ? (
                        <div className="p-8 flex flex-col items-center gap-3">
                            <Loader2 className="animate-spin text-emerald-500" size={20} />
                            <p className="text-[9px] font-black text-slate-300 uppercase">Sincronizando chats...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                            <MessageSquare className="mx-auto text-slate-200" size={32} />
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Sin chats activos</p>
                        </div>
                    ) : (
                        sessions.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setSelectedSession(s)}
                                className={cn(
                                    "w-full p-4 text-left transition-all duration-300 relative group",
                                    selectedSession?.id === s.id ? "bg-emerald-50" : "hover:bg-slate-50"
                                )}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-black text-xs text-slate-400 shrink-0 shadow-sm transition-transform group-hover:scale-105">
                                        {s.customerName ? s.customerName[0] : <User size={16} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-start mb-1">
                                            <p className="text-[11px] font-black text-slate-800 uppercase truncate pr-2 leading-none">{s.customerName || "Anónimo"}</p>
                                            <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{new Date(s.updatedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <p className="text-[10px] font-medium text-slate-500 truncate leading-tight italic">
                                            {s.messages?.[s.messages.length - 1]?.content || "Iniciando..."}
                                        </p>
                                    </div>
                                </div>
                                {selectedSession?.id === s.id && (
                                    <div className="absolute left-0 top-0 w-1 h-full bg-emerald-600" />
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 🔴 Ventana Principal de Chat */}
            <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden relative">
                {selectedSession ? (
                    <>
                        <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-900/10">
                                    <User size={24} strokeWidth={2.5} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{selectedSession.customerName || selectedSession.phoneNumber || "Anónimo"}</h3>
                                        <a href={`https://wa.me/${selectedSession.phoneNumber}`} target="_blank" className="p-1 hover:bg-emerald-50 rounded transition-colors">
                                            <Phone size={12} className="text-emerald-600" />
                                        </a>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={cn(
                                            "flex items-center gap-1 text-[9px] font-black uppercase tracking-widest",
                                            intervencionGlobal ? "text-orange-600" : "text-emerald-600"
                                        )}>
                                            <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", intervencionGlobal ? "bg-orange-500" : "bg-emerald-500")} />
                                            {intervencionGlobal ? "Intervención Humana (Pausa IA)" : "Atendido por El Verdulero (IA)"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleToggleIntervencion}
                                    className={cn(
                                        "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm border",
                                        intervencionGlobal
                                            ? "bg-slate-900 text-white border-slate-800"
                                            : "bg-white text-orange-600 border-orange-100 hover:bg-orange-50"
                                    )}
                                >
                                    {intervencionGlobal ? <Bot size={16} /> : <UserCheck size={16} />}
                                    {intervencionGlobal ? "Reactivar Robot" : "Intervenir Chat"}
                                </button>
                                <button
                                    onClick={async () => {
                                        if (confirm("¿Finalizar esta sesión de chat?")) {
                                            await fetch('/api/admin/chats', {
                                                method: 'PATCH',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ id: selectedSession.id, isActive: false })
                                            });
                                            setSelectedSession(null);
                                            fetchSessions();
                                        }
                                    }}
                                    className="p-2.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-100 bg-white"
                                    title="Finalizar Chat"
                                >
                                    <ShieldAlert size={18} />
                                </button>
                                <button className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors border border-slate-100">
                                    <MoreVertical size={18} />
                                </button>
                            </div>
                        </header>

                        {/* Area de Mensajes */}
                        <div
                            ref={scrollRef}
                            className="flex-1 overflow-y-auto p-8 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed"
                        >
                            {selectedSession.messages?.map((m: any, i: number) => (
                                <div key={i} className={cn("flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300", m.role === 'user' ? "justify-start" : "justify-end")}>
                                    <div className={cn(
                                        "max-w-[80%] flex flex-col gap-1.5",
                                        m.role === 'user' ? "items-start" : "items-end"
                                    )}>
                                        <div className={cn(
                                            "p-4 rounded-2xl text-[13px] font-bold leading-relaxed shadow-sm transition-all",
                                            m.role === 'user'
                                                ? "bg-white border border-slate-200 text-slate-800 rounded-bl-none"
                                                : "bg-emerald-600 text-white rounded-br-none shadow-emerald-900/10"
                                        )}>
                                            {m.content}
                                        </div>
                                        <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest px-1">
                                            {new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} • {m.role === 'user' ? 'Cliente' : 'IA'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Input de Control */}
                        <div className="p-4 bg-white border-t border-slate-100 relative">
                            <AnimatePresence>
                                {!intervencionGlobal && (
                                    <motion.div
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center p-4"
                                    >
                                        <div className="flex items-center gap-3 bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl">
                                            <ShieldAlert size={18} className="text-orange-400" />
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">IA en control • Intervén para responder</p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <form onSubmit={handleSendMessage} className="flex gap-3 relative z-0">
                                <div className="flex-1 relative">
                                    <input
                                        value={input}
                                        onChange={e => setInput(e.target.value)}
                                        placeholder="Escribe tu mensaje como El Verdulero..."
                                        className="w-full h-14 bg-slate-50 border border-slate-200 rounded-2xl px-6 text-sm font-bold text-slate-800 outline-none focus:ring-4 focus:ring-emerald-500/5 focus:bg-white focus:border-emerald-200 transition-all shadow-inner"
                                    />
                                </div>
                                <button
                                    disabled={!input.trim() || sending}
                                    className="h-14 w-14 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/10 hover:scale-[1.03] active:scale-95 disabled:opacity-50 transition-all"
                                >
                                    {sending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} className="translate-x-0.5 -translate-y-0.5" />}
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-20 gap-6">
                        <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200 shadow-inner border border-slate-100">
                            <MessageSquare size={48} strokeWidth={1} />
                        </div>
                        <div className="space-y-2">
                            <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">Centro de Mensajería</h4>
                            <p className="text-[11px] font-bold text-slate-400 max-w-[250px] uppercase leading-relaxed">Selecciona una conversación a la izquierda para entrar en modo despacho o intervención.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                                <Zap size={10} className="fill-current" />
                                <span className="text-[9px] font-black uppercase tracking-tighter">SAPI conectado</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-400 rounded-full border border-slate-200">
                                <Clock size={10} />
                                <span className="text-[9px] font-black uppercase tracking-tighter">Real-time polling</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
