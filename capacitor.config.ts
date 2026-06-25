import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elbaz.platform',
  appName: 'Elbaz Courses',
  webDir: 'dist/public',
  server: {
    // In development, proxy to the Vite dev server
    // In production, we use the local bundled files (dist/public)
    // If you want to load a live website, uncomment the URL below
    url: process.env.NODE_ENV === 'development' 
      ? 'http://localhost:5173' 
      : undefined, // Defaults to local webDir
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#070b12',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#070b12',
    },
  },
};

export default config;
