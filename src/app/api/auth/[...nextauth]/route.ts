import NextAuth from "next-auth";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Usuario", type: "text" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                // Buscar por nombre de usuario (campo name) o por email — sin distinción de mayúsculas
                const user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { name: { equals: credentials.email, mode: "insensitive" } },
                            { email: { equals: credentials.email, mode: "insensitive" } }
                        ]
                    }
                });

                if (!user) return null;

                const isPasswordValid = await bcrypt.compare(credentials.password, user.password);

                if (!isPasswordValid) return null;

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                };
            }
        })
    ],
    session: {
        strategy: "jwt" as const,
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user?.id) token.id = user.id;
            return token;
        },
        async session({ session, token }) {
            if (session.user && token?.id) {
                (session.user as typeof session.user & { id?: string }).id = token.id as string;
            }
            return session;
        }
    },
    pages: {
        signIn: "/admin/login",
    },
    secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
