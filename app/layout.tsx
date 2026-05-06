import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Calidad Latas | Control movil",
  description:
    "Aplicacion movil para inspeccionar packs de latas de aluminio antes de su limpieza y reciclaje en planta.",
  applicationName: "Calidad Latas",
  appleWebApp: {
    capable: true,
    title: "Calidad Latas",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-slate-950 antialiased`}
    >
      <body className="min-h-full bg-[radial-gradient(circle_at_top,#164e63_0,#0f172a_38%,#020617_100%)] text-slate-950">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-slate-50 shadow-2xl shadow-black/35">
          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
                  Planta reciclaje
                </p>
                <h1 className="text-xl font-bold leading-tight text-slate-950">
                  Calidad de packs
                </h1>
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Turno activo
              </div>
            </div>
          </header>

          <div className="flex flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
