// Capacitor global types — lightweight augmentation for Window
// The @capacitor/core package injects a global `Capacitor` object at runtime
interface CapacitorGlobal {
  isNativePlatform: () => boolean;
  // add other Capacitor methods as needed
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export {};
