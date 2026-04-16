import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: 'NearMe v0.5.0',
  description: 'Test your local knowledge with 10 nearby images.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.GOOGLE_API_KEY}&libraries=places`}
          strategy="beforeInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
