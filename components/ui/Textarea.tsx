import * as React from "react";
import { cn } from "@/lib/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-[3px] border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed text-content placeholder:text-content-faint transition-[border-color,box-shadow] duration-fast ease-out outline-none hover:border-border-strong focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";