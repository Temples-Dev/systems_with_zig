import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import CoursePage from "@/pages/CoursePage";
import DashboardPage from "@/pages/DashboardPage";
import LabPage from "@/pages/LabPage";
import LabsPage from "@/pages/LabsPage";
import LoginPage from "@/pages/LoginPage";
import ModulePage from "@/pages/ModulePage";
import PlaygroundPage from "@/pages/PlaygroundPage";
import ProfilePage from "@/pages/ProfilePage";
import RegisterPage from "@/pages/RegisterPage";
import ResourcesPage from "@/pages/ResourcesPage";
import SharePage from "@/pages/SharePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Authenticated shell — AppLayout handles the token guard */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/curriculum" element={<CoursePage />} />
        <Route path="/module/:slug" element={<ModulePage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/share/:slug" element={<SharePage />} />
        <Route path="/labs" element={<LabsPage />} />
        <Route path="/labs/:slug" element={<LabPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
