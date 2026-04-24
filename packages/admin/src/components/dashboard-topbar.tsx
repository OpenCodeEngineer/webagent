"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DashboardTopbarProps {
  userEmail: string;
  userName?: string;
}

export function DashboardTopbar({ userEmail, userName }: DashboardTopbarProps) {
  const initial = (userName ?? userEmail).charAt(0).toUpperCase();

  return (
    <header className="hidden items-center justify-end gap-3 border-b border-border bg-background px-6 py-3 lg:flex">
      <span className="max-w-[220px] truncate text-sm text-muted-foreground">
        {userEmail}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: "ghost" }) + " h-8 w-8 rounded-full p-0"}
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="cursor-pointer"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
