import type { CapacitorConfig } from '@capacitor/cli';

// Android app: the same web build (dist/) inside a native WebView.
const config: CapacitorConfig = {
  appId: 'io.github.lukajakimovski.tally',
  appName: 'Tally',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Lets the app talk to a sync server over plain http (e.g. a Tailscale IP).
    // HTTPS (`tailscale serve`) is still recommended.
    allowMixedContent: true,
  },
};

export default config;
