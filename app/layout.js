import "./globals.css";

export const metadata = {
  title: "Kario's budget",
  description: "תקציב משפחתי משותף",
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
