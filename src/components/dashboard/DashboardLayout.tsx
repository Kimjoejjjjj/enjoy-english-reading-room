import Sidebar from "./Sidebar";
import DashboardContent from "./DashboardContent";

export default function DashboardLayout() {
  return (
    <div className="flex h-svh w-full bg-background">
      <Sidebar />
      <DashboardContent />
    </div>
  );
}
