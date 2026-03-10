import { cookies } from "next/headers";
import { Suspense } from "react";
import {
  AppSidebar,
  AppSidebarSkeleton,
} from "@/components/app-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "../(auth)/auth";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  // Read sidebar state from cookie so the space-reserving div is sized
  // correctly from the very first byte — eliminates sidebar-width CLS.
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <DataStreamProvider>
      <SidebarProvider defaultOpen={!isCollapsed}>
        {/* Only auth resolution is deferred; sidebar space is already correct */}
        <Suspense fallback={<AppSidebarSkeleton />}>
          <AuthedSidebar />
        </Suspense>
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </DataStreamProvider>
  );
}

async function AuthedSidebar() {
  const session = await auth();
  return <AppSidebar user={session?.user} />;
}
