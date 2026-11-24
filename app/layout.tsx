import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Конспект — из лекций в знания",
  description: "Загрузите лекцию, создайте вопросы по материалу и проверьте себя. Ваше личное пространство для учёбы.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
