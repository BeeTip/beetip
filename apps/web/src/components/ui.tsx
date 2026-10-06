import * as Dialog from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(...values));
const button = cva("button", { variants: { variant: { primary: "button-primary", secondary: "button-secondary", ghost: "button-ghost", danger: "button-danger" } }, defaultVariants: { variant: "primary" } });
export function Button({ className, variant, asChild, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(button({ variant }), className)} {...props} />;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><div className="empty-mark">B</div><h2>{title}</h2><p>{children}</p></div>; }
export function Amount({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={cn("amount-row", strong && "amount-total")}><span>{label}</span><strong>{value}</strong></div>; }
export function Modal({ trigger, title, description, children }: { trigger: ReactNode; title: string; description: string; children: ReactNode }) {
  return <Dialog.Root><Dialog.Trigger asChild>{trigger}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="section-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Tutup dialog"><X size={20} /></Button></Dialog.Close></div><Dialog.Description>{description}</Dialog.Description>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
