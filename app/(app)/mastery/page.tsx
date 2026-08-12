import { redirect } from "next/navigation";

// The standalone Mastery tab was folded into the Map (/graph) as a list/graph
// toggle. Redirect to the graph in list mode so an old /mastery link lands on
// the mastery list, not the graph canvas. Keep as a redirect so
// history/bookmarks don't 404.
export default function MasteryRedirect() {
  redirect("/graph?view=list");
}