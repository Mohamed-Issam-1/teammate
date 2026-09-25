import * as React from "react";
import { cn } from "cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground hover:border-foreground/35 focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 file:text-foreground flex h-9 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:px-2 file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
