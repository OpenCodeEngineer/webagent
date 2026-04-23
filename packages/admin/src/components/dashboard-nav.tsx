"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Create Agent", href: "/create" },
  { label: "Settings", href: "/dashboard/settings" },
];

interface DashboardNavProps {
  userEmail: string;
}

export function DashboardNav({ userEmail }: DashboardNavProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  const NavLinks = () => (
    <nav className="flex-1 space-y-1 px-4 py-6">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setSidebarOpen(false)}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-gray-800 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-gray-900 px-4 py-3 lg:hidden">
        <span className="text-sm font-semibold text-white">WebAgent Admin</span>
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="rounded p-1 text-gray-300 hover:text-white"
          aria-label="Toggle menu"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gray-900 transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center px-6">
          <span className="text-lg font-bold text-white">WebAgent Admin</span>
        </div>
        <NavLinks />
        <div className="border-t border-gray-700 px-4 py-4">
          <p className="truncate text-xs text-gray-400">{userEmail}</p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2 w-full rounded-lg bg-gray-800 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Spacer for mobile top bar */}
      <div className="h-12 w-full lg:hidden" />
    </>
  );
}
