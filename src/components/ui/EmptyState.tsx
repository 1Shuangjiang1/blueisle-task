import type { ReactNode } from "react";
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="ui-empty"><strong>{title}</strong><span>{description}</span>{action}</div>;
}
