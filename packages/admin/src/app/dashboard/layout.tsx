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
  const userName = session.user.name ?? undefined;
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = adminEmails.includes(userEmail.toLowerCase());

  return (
    <div className="flex min-h-screen">
      <DashboardNav userEmail={userEmail} userName={userName} isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col lg:pl-64">
        <DashboardTopbar userEmail={userEmail} userName={userName} />
        <main className="flex-1 bg-background px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
