import "./globals.css";
import type { Metadata } from "next";
import { NavLink } from "./nav";
import { AuthGate, SignOutButton } from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "DropWatch",
  description: "Personal India price-drop intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <AuthGate>
          <nav className="nav">
            <div className="brand">Drop<span>Watch</span></div>
            <NavLink href="/">Apps</NavLink>
            <NavLink href="/alerts">Alerts</NavLink>
            <NavLink href="/cards">Cards</NavLink>
            <NavLink href="/archive">Trash</NavLink>
            <SignOutButton />
          </nav>
          <main className="container">{children}</main>
        </AuthGate>
      </body>
    </html>
  );
}
