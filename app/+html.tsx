// Web-only HTML shell for the Expo Router static export. Adds the Barlow +
// Barlow Condensed webfonts the landing page uses (matches the marketing site).
// Native is unaffected — this file is web-only.
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,800;1,800&family=Barlow:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* PWA bits. The manifest is what lets iOS "Add to Home Screen" install
            the app — and on iPhone that install is the ONLY way Web Push is
            allowed to work at all. Desktop and Android don't need it, but it
            also makes the app installable there. Files live in public/ and are
            copied verbatim into dist/ by the static export. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#534AB7" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="IamSports" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
