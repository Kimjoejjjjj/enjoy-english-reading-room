import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { verifyToken } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get("token")?.value;
  if (!token || !verifyToken(token)) redirect("/");
  return <DashboardShell>{children}</DashboardShell>;
}
