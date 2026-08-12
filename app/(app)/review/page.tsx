import { redirect } from "next/navigation";

// The standalone Review tab was folded into Decks (the cross-deck "Review all
// due" session now mounts on /decks; per-deck review still lives at /decks/[id]).
// Keep the route as a redirect so history/bookmarks don't 404.
export default function ReviewRedirect() {
  redirect("/decks");
}