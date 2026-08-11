"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  side = "center",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  side?: "center" | "left" | "right" | "bottom";
}) {
  const position =
    side === "left"
      ? "left-0 top-0 h-full w-[20rem] max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-r-[4px] border-y-0 border-l-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
      : side === "right"
        ? "right-0 top-0 h-full w-[24rem] max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-l-[4px] border-y-0 border-r-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
        : side === "bottom"
          ? "left-1/2 bottom-0 top-auto w-full max-w-none -translate-x-1/2 translate-y-0 rounded-none rounded-t-[6px] border-b-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
          : "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[4px] data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95";
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 border border-border bg-surface shadow-card",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          position,
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-content-faint transition-colors hover:bg-surface-2 hover:text-content focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            <X size={15} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pb-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-serif text-lg font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 text-[13px] text-content-muted", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 p-5 pt-3", className)}
      {...props}
    />
  );
}