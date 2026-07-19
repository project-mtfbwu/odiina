import type { ReactNode } from "react";

export function StatusCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel status-card">
      <h2>{title}</h2>
      <p>{children}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
