import AdminSidebar from "@/components/admin/Sidebar";
import SessionWrapper from "@/components/admin/SessionWrapper";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <SessionWrapper>
            <div className="flex min-h-screen bg-gray-50">
                <AdminSidebar />
                <main className="flex-1 overflow-y-auto w-0 pt-16 md:pt-0">
                    {children}
                </main>
            </div>
        </SessionWrapper>
    );
}
