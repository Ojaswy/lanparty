import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "pixel" | "huge";
  tone?: "normal" | "primary" | "danger" | "green";
  children: ReactNode;
}

export function Button({ variant = "default", tone = "normal", className, children, type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", variant !== "default" ? variant : "", tone !== "normal" ? tone : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Anchor styled as a button (for links that open new tabs). */
export function LinkButton({
  href,
  disabled,
  children,
  variant = "default",
  className,
  target,
}: {
  href?: string;
  disabled?: boolean;
  children: ReactNode;
  variant?: "default" | "pixel" | "huge";
  className?: string;
  target?: string;
}) {
  const cls = ["btn", variant !== "default" ? variant : "", className ?? ""].filter(Boolean).join(" ");
  if (disabled || !href) {
    return (
      <button type="button" className={cls} disabled>
        {children}
      </button>
    );
  }
  return (
    <a className={cls} href={href} target={target} rel={target === "_blank" ? "noreferrer noopener" : undefined}>
      {children}
    </a>
  );
}
