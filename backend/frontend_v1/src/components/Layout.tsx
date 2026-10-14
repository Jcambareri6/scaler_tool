import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import PendingAccountScreen from "./PendingAccountScreen";
import { useAccount } from "@/lib/accountContext";

export default function Layout() {
  const { account, loading } = useAccount();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--background)" }}>
        <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(227,11,16,0.2)", borderTopColor: "#FF8A8D" }} />
      </div>
    );
  }

  // Cuenta sin aprobar (o rechazada): no se muestra la app, el backend
  // igual le rechazaria todos los pedidos.
  if (account && account.status !== "approved") {
    return <PendingAccountScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden relative" style={{ background: "var(--background)" }}>
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute rounded-full"
          style={{
            width: 700,
            height: 700,
            top: "-18%",
            left: "-10%",
            background: "radial-gradient(circle, rgba(227,11,16,0.10) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 600,
            height: 600,
            bottom: "-15%",
            right: "-8%",
            background: "radial-gradient(circle, rgba(141,0,6,0.09) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 380,
            height: 380,
            top: "45%",
            left: "38%",
            background: "radial-gradient(circle, rgba(141,0,6,0.06) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
        />
      </div>

      <Sidebar />
      <main className="flex-1 overflow-auto relative z-10">
        <Outlet />
      </main>
    </div>
  );
}
