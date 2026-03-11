import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata = {
    title: "El Verdulero | Control Center",
    description: "Sistema de Inteligencia Comercial para El Verdulero",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="es" className={`${inter.variable} ${outfit.variable}`}>
            <body className="bg-[#F4F7F5] text-slate-900 antialiased font-sans">
                {children}
            </body>
        </html>
    );
}
