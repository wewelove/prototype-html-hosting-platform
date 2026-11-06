import { Brand } from "@/components/brand";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <aside className="auth-brand">
        <Brand />
      </aside>
      <main className="auth-main">
        <section className="auth-panel">{children}</section>
      </main>
    </div>
  );
}
