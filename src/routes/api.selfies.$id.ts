import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/selfies/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveSocialPhoto } = await import("@/lib/social-photo.server");
        return serveSocialPhoto(request, params.id);
      },
    },
  },
});
