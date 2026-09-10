import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
};

export function Button({ tone = "secondary", size = "md", className = "", children, ...props }: ButtonProps) {
  return <button className={`ui-button ui-button--${tone} ui-button--${size} ${className}`.trim()} {...props}>{children}</button>;
}
