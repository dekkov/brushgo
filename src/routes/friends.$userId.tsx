import { createFileRoute, Link } from "@tanstack/react-router";
import { FriendsFeed } from "@/components/FriendsFeed";
import { z } from "zod";

export const Route = createFileRoute("/friends/$userId")({
  component: FriendHistory,
});

function FriendHistory() {
  const { userId } = Route.useParams();
  if (!z.string().uuid().safeParse(userId).success)
    return <p role="alert">This friend profile is unavailable.</p>;
  return (
    <div className="space-y-5">
      <Link to="/friends" className="text-sm underline">
        Back to Friends
      </Link>
      <FriendsFeed ownerId={userId} />
    </div>
  );
}
