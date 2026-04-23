"use client";

import { signOut } from "next-auth/react";

interface DashboardTopbarProps {
  userEmail: string;
}

export function DashboardTopbar({ userEmail }: DashboardTopbarProps) {
  const initial = userEmail.charAt(0).toUpperCase();

  return (
    <header className="flex items-center justify-end gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <span className="hidden sm:block max-w-[220px] truncate text-sm text-gray-600">
        {userEmail}
      </span>
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-sm font-semibold text-white"
        aria-label={`User: ${userEmail}`}
      >
        {initial}
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
      >
        Sign out
      </button>
    </header>
  );
}
