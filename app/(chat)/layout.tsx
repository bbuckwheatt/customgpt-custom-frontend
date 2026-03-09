import { cookies } from "next/headers";
import { Suspense } from "react";
import {
  AppSidebar,
  AppSidebarSkeleton,
} from "@/components/app-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "../(auth)/auth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DataStreamProvider>
        {/* Fallback renders a sidebar skeleton + children in place so the layout
            doesn't shift when auth/cookies resolve (CLS fix). defaultOpen keeps
            the sidebar space reserved for the common case. */}
        <Suspense
          fallback={
            <SidebarProvider defaultOpen>
              <AppSidebarSkeleton />
              <SidebarInset>{children}</SidebarInset>
            </SidebarProvider>
          }
        >
          <SidebarWrapper>{children}</SidebarWrapper>
        </Suspense>
      </DataStreamProvider>
    </>
  );

}

async function SidebarWrapper({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={session?.user} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
