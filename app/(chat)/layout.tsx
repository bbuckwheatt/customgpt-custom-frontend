import { cookies } from "next/headers";
import Script from "next/script";
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
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <>
      {/* Pyodide is only needed when running Python code in the artifact panel.
          lazyOnload defers it to browser idle time so it never blocks render. */}
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <SidebarProvider defaultOpen={!isCollapsed}>
          {/* Sidebar shape renders synchronously from cookie; only the user data
              (auth) suspends — the main content area is never blocked. */}
          <Suspense fallback={<AppSidebarSkeleton />}>
            <AppSidebarWithUser />
          </Suspense>
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </DataStreamProvider>
    </>
  );
}

async function AppSidebarWithUser() {
  const session = await auth();
  return <AppSidebar user={session?.user} />;
}
