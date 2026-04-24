"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bot,
  LayoutDashboard,
  PlusCircle,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface DashboardNavProps {
  userEmail: string;
  userName?: string;
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Create Agent", href: "/create", icon: PlusCircle },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

function NavContent({
  userEmail,
  userName,
  onNavigate,
}: {
  userEmail: string;
  userName?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const initial = (userName ?? userEmail).charAt(0).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4">
        <Bot className="h-5 w-5 text-primary" />
        <span className="text-base font-semibold">Lamoom</span>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Nav items */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full justify-start gap-2 font-normal",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* User footer */}
      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {userEmail}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7 flex-shrink-0")}>
            <LogOut className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function DashboardNav({ userEmail, userName }: DashboardNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:flex lg:flex-col">
        <NavContent userEmail={userEmail} userName={userName} />
      </aside>

      {/* Mobile: hamburger + sheet */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-3 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }))} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <NavContent
              userEmail={userEmail}
              userName={userName}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Lamoom</span>
        </div>
      </div>

      {/* Spacer for mobile top bar */}
      <div className="h-12 lg:hidden" />
    </>
  );
}
