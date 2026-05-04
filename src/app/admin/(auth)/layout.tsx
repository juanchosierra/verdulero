import SessionWrapper from "@/components/admin/SessionWrapper";

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <SessionWrapper>
            {children}
        </SessionWrapper>
    );
}
