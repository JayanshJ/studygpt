import type { Metadata } from "next";
import { Newsreader, JetBrains_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ThemeScript } from "./ThemeScript";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "StudyGPT",
  description: "A local study companion for concept-heavy learning.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The no-flash theme script (in ThemeScript) sets data-theme on <html>
      // before paint, so the client DOM carries an attribute the server HTML
      // doesn't have. suppressHydrationWarning is the standard fix for this
      // pattern (same approach next-themes uses).
      suppressHydrationWarning
      className={`${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {/* Emits the theme-init script into the SSR stream via
            useServerInsertedHTML, outside React's client tree, so it runs
            before paint (no flash) and React 19 never warns about a <script>
            rendered on the client. */}
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}