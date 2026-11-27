import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { PrivateSelfie } from "@/components/PrivateSelfie";
import { useAuth } from "@/hooks/useAuth";

const params = z.object({ id: z.string().uuid(), revision: z.string().uuid() });

export const Route = createFileRoute("/selfie/$id/$revision")({
  head: () => ({ meta: [{ title: "Selfie — Brushy" }] }),
  component: () => (
    <AppShell>
      <NotificationSelfie />
    </AppShell>
  ),
});

function NotificationSelfie() {
  const { user } = useAuth();
  const photo = params.safeParse(Route.useParams());
  return (
    <section className="space-y-4">
      <h1 className="font-display text-xl font-bold">Brushing selfie</h1>
      {photo.success && user ? (
        <PrivateSelfie
          key={`${user.id}:${photo.data.id}:${photo.data.revision}`}
          {...photo.data}
          viewerId={user.id}
          alt="Brushing selfie"
        />
      ) : (
        <p role="status">This selfie is unavailable.</p>
      )}
      <Link to="/" className="underline">
        Back to home
      </Link>
    </section>
  );
}
