import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  if (user && !params.returnTo) redirect("/projects");
  return (
    <AuthShell>
      <LoginForm returnTo={params.returnTo} />
    </AuthShell>
  );
}
