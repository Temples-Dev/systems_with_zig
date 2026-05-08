import { cn } from "@/lib/utils";

export function Page({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-screen", className)} {...props} />;
}

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-3xl px-6", className)} {...props} />;
}

export function TopBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-background shadow-sm",
        className
      )}
    >
      <Container className="flex h-14 items-center justify-between">{children}</Container>
    </header>
  );
}
