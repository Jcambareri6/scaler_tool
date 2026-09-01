import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function Layout() {
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
            background: "radial-gradient(circle, rgba(99,77,220,0.10) 0%, transparent 70%)",
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
            background: "radial-gradient(circle, rgba(56,48,180,0.09) 0%, transparent 70%)",
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
            background: "radial-gradient(circle, rgba(80,60,200,0.06) 0%, transparent 70%)",
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
