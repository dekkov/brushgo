import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CalendarDays, Home, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AuthCard } from "./AuthCard";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen" />;
  if (!user)
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-fresh text-3xl shadow-soft">🪥</div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Brushy</h1>
          <p className="mt-3 text-muted-foreground">Snap a live selfie while you brush, morning and night. Keep the flame alive and look back on every day.</p>
        </div>
        <AuthCard />
      </main>
    );
  return (
    <div className="mx-auto min-h-svh max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between py-5">
        <Link to="/" className="font-display text-2xl font-extrabold">🪥 Brushy</Link>
        <nav className="flex items-center gap-1">
          <Link to="/" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" activeProps={{ className: "text-primary" }} aria-label="Home"><Home className="h-5 w-5" /></Link>
          <Link to="/calendar" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" activeProps={{ className: "text-primary" }} aria-label="Calendar"><CalendarDays className="h-5 w-5" /></Link>
          <button onClick={() => supabase.auth.signOut()} className="rounded-full p-2 text-muted-foreground hover:bg-secondary" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
        </nav>
      </header>
      {children}
    </div>
  );
}
