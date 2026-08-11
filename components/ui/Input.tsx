import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[3px] border border-border bg-surface px-3 text-[13px] text-content placeholder:text-content-faint transition-[border-color,box-shadow] duration-fast ease-out outline-none hover:border-border-strong focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";