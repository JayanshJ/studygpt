export interface ConversationGroup<T> {
  label: string;
  items: T[];
}

const DAY_MS = 86_400_000;

// Claude-style recency buckets for the sidebar conversation list: Today,
// Yesterday, Previous 7 days, then everything earlier. Empty groups are
// omitted so headers only appear when they have rows beneath them.
export function groupConversationsByRecency<T extends { created_at: number }>(
  items: T[],
  now: number = Date.now(),
): Array<ConversationGroup<T>> {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - DAY_MS;
  const startOfPreviousWeek = startOfYesterday - 6 * DAY_MS;

  const today: T[] = [];
  const yesterday: T[] = [];
  const previousWeek: T[] = [];
  const earlier: T[] = [];

  for (const item of items) {
    if (item.created_at >= startOfToday) today.push(item);
    else if (item.created_at >= startOfYesterday) yesterday.push(item);
    else if (item.created_at >= startOfPreviousWeek) previousWeek.push(item);
    else earlier.push(item);
  }

  return (
    [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "Previous 7 days", items: previousWeek },
      { label: "Earlier", items: earlier },
    ] satisfies ConversationGroup<T>[]
  ).filter((group) => group.items.length > 0);
}
