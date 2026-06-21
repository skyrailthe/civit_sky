import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Civit Sky",
  description: "Генерация изображений на моделях Civitai через RunPod",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
