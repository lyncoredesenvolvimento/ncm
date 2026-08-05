import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NCM Compliant - Portal de Conformidade Fiscal",
  description: "Classificação inteligente de Nomenclatura Comum do Mercosul (NCM) com Inteligência Artificial e conformidade fiscal.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
