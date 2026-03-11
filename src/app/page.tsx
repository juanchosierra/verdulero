"use client";

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Send, Loader2, Sparkles, ShoppingBasket, CheckCircle2, User, Bot, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

type Message = {
    role: 'user' | 'assistant';
    content: string;
    type?: 'text' | 'order' | 'info';
};

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: '¡Qué tal, marchante! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué le vamos a poner a la canasta hoy?', type: 'text' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let storedId = localStorage.getItem('chat_session_id');
        if (!storedId) {
            storedId = 'web_' + Math.random().toString(36).substring(2, 9);
            localStorage.setItem('chat_session_id', storedId);
        }
        setSessionId(storedId);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage, type: 'text' }]);
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, { role: 'user', content: userMessage }],
                    sessionId: sessionId,
                    customerName: "Visitante Web"
                }),
            });

            const data = await response.json();
            if (data.content) {
                setMessages(prev => [...prev, { role: 'assistant', content: data.content, type: 'text' }]);
            }
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: 'Ay caramba, se me enredó un poco el pedido. ¿Me repites?', type: 'text' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <main className="flex flex-col h-screen max-w-2xl mx-auto bg-white border-x border-gray-100 shadow-premium relative overflow-hidden font-sans">
            {/* Background patterns */}
            <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none -z-10" />

            {/* Header */}
            <header className="px-8 py-6 flex items-center justify-between border-b border-gray-100 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="flex items-center gap-4 group">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-lg group-hover:blur-xl transition-all duration-500 opacity-50" />
                        <div className="w-14 h-14 relative bg-white rounded-2xl border border-gray-100 shadow-premium flex items-center justify-center overflow-hidden">
                            <Image
                                src="https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"
                                alt="El Verdulero"
                                fill
                                className="object-contain p-2"
                            />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-4 border-white rounded-full shadow-sm shadow-green-500/50" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none group-hover:text-primary transition-colors">El Verdulero</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-600 mt-1 flex items-center gap-1">
                            <Sparkles size={10} /> Atendiendo ahora
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end gap-1 px-4 py-2 bg-gray-50/50 rounded-2xl border border-gray-100">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-none">Entrega Estimada</span>
                        <span className="text-xs font-bold text-gray-700">Hoy 10:00 AM - 5:00 PM</span>
                    </div>
                    <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all duration-300">
                        <ShoppingBasket size={22} />
                    </button>
                </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-8 py-10 space-y-8">
                <AnimatePresence>
                    {messages.map((m, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
                            className={cn(
                                "flex flex-col",
                                m.role === 'user' ? "items-end" : "items-start"
                            )}
                        >
                            <div className="flex items-center gap-2 mb-2 px-1">
                                {m.role === 'assistant' && <div className="p-1 bg-primary/10 rounded px-1.5"><Bot size={10} className="text-primary" /></div>}
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                    {m.role === 'assistant' ? 'El Verdulero' : 'Tú'}
                                </span>
                                {m.role === 'user' && <div className="p-1 bg-gray-100 rounded px-1.5"><User size={10} className="text-gray-500" /></div>}
                            </div>
                            <div
                                className={cn(
                                    "p-5 rounded-[2rem] text-sm font-medium leading-relaxed shadow-sm max-w-[85%] transition-all duration-300",
                                    m.role === 'assistant'
                                        ? "bg-white border border-gray-100 text-gray-800 rounded-tl-none hover:shadow-premium"
                                        : "bg-primary text-white rounded-tr-none shadow-lg shadow-primary/20"
                                )}
                            >
                                {m.content}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
                {isLoading && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 bg-gray-50/50 w-fit px-6 py-4 rounded-[1.5rem] border border-gray-100"
                    >
                        <div className="flex gap-1.5">
                            <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></span>
                        </div>
                        <span className="text-xs font-black uppercase tracking-widest text-primary/50">El Verdulero está revisando...</span>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-8 pb-10 pt-4 bg-white/80 backdrop-blur-xl border-t border-gray-50 sticky bottom-0 z-50">
                <form onSubmit={handleSubmit} className="flex gap-2 relative group">
                    <div className="absolute inset-0 bg-primary/5 rounded-3xl blur-2xl group-focus-within:bg-primary/10 transition-all duration-500 -z-10" />
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="¿Qué le vamos a poner a la canasta?"
                        disabled={isLoading}
                        className="flex-1 bg-gray-50/80 border border-gray-100/50 px-8 py-5 rounded-3xl text-sm font-semibold outline-none focus:bg-white focus:border-primary/30 focus:shadow-premium transition-all duration-300 placeholder:text-gray-400"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="bg-primary text-white p-5 rounded-3xl shadow-xl shadow-primary/30 hover:shadow-2xl hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100 transition-all duration-300 group/send"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                    </button>
                </form>
                <div className="flex justify-center gap-6 mt-6">
                    <div className="flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Pago contra entrega</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Sparkles size={12} className="text-accent-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Calidad Grantizada</span>
                    </div>
                </div>
            </div>
        </main>
    );
}
