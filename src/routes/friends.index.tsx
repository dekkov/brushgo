import { createFileRoute } from "@tanstack/react-router";
import { FriendsManager } from "@/components/FriendsManager";

export const Route = createFileRoute("/friends/")({
  component: FriendsManager,
});
