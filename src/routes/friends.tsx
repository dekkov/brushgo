import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/friends")({
  head: () => ({ meta: [{ title: "Friends — Brushy" }] }),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
