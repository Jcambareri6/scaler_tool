import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/authContext";
import { ToastProvider } from "@/lib/toastContext";
import RequireAuth from "@/components/RequireAuth";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import NewProjectPage from "@/pages/NewProjectPage";
import ProjectWorkspacePage from "@/pages/ProjectWorkspacePage";
import ScriptStylesPage from "@/pages/ScriptStylesPage";
import SettingsPage from "@/pages/SettingsPage";
import WorkspacesPage from "@/pages/WorkspacesPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/new" element={<NewProjectPage />} />
              <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
              <Route path="/script-styles" element={<ScriptStylesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/workspaces" element={<WorkspacesPage />} />
              <Route path="/invites/:token" element={<AcceptInvitePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
