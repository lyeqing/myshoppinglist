import Link from "next/link";
import type { Session } from "@/lib/api-types";

type Section = "lists" | "in-store" | "stores" | "products" | "archives";

export default function MainNavigation({ session, active, className = "" }: {
  session: Session | null;
  active: Section;
  className?: string;
}) {
  const registered = !!session && !session.account.isTrial;
  const links = [
    { section: "lists", href: "/", label: "My lists", visible: true },
    { section: "in-store", href: "/in-store", label: "Shop in store", visible: true },
    { section: "stores", href: "/settings", label: "Setting", visible: !!session },
    { section: "products", href: "/products/history", label: "Products", visible: registered },
    { section: "archives", href: "/history", label: "Archived lists", visible: registered && session.account.isPaid },
  ];
  return (
    <nav aria-label="Main navigation" className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold ${className}`}>
      {links.filter((link) => link.visible).map((link) => (
        <Link key={link.section} href={link.href}
          aria-current={active === link.section ? "page" : undefined}
          className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-600 ${active === link.section ? "text-primary-700 underline decoration-2 underline-offset-8" : "hover:text-primary-700"}`}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
