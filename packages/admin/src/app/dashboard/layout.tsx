import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard-nav";
import { DashboardTopbar } from "@/components/dashboard-topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userEmail = session.user.email ?? "";

  return (
    <div className="flex min-h-screen">
      <DashboardNav userEmail={userEmail} />
      <div className="flex flex-1 flex-col lg:pl-64">
        <DashboardTopbar userEmail={userEmail} />
        <main className="flex-1 bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
