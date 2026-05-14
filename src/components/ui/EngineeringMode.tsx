import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface EngineeringModeContextType {
  isActive: boolean;
  toggle: () => void;
}

const EngineeringModeContext = createContext<EngineeringModeContextType>({
  isActive: false,
  toggle: () => {},
});

export function useEngineeringMode() {
  return useContext(EngineeringModeContext);
}

export function EngineeringModeProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);

  const toggle = useCallback(() => {
    setIsActive(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("engineering-mode");
      } else {
        document.documentElement.classList.remove("engineering-mode");
      }
      return next;
    });
  }, []);

  return (
    <EngineeringModeContext.Provider value={{ isActive, toggle }}>
      {children}
    </EngineeringModeContext.Provider>
  );
}

// Toggle Button component to put in Navbar
export function EngineeringModeToggle() {
  const { isActive, toggle } = useEngineeringMode();

  return (
    <button
      onClick={toggle}
      aria-label="Toggle Engineering Vision Mode"
      title={isActive ? "Disable Engineering Mode" : "Enable Engineering Vision"}
      className={`relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-300 ${
        isActive
          ? "border-[#10b981] bg-[rgba(16,185,129,0.12)] text-[#10b981] shadow-[0_0_12px_rgba(16,185,129,0.3)]"
          : "border-[#1e2d3d] bg-[#0d1420] text-[#475569] hover:border-[#06b6d4] hover:text-[#06b6d4]"
      }`}
    >
      {/* Waveform icon */}
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="shrink-0">
        <path
          d="M0 5 L2 5 L3 1 L4 9 L5 2 L6 8 L7 5 L9 5 L10 3 L11 7 L12 4 L13 6 L14 5 L16 5"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: isActive ? "none" : "4 2",
            animation: isActive ? "waveform-dash 0.8s linear infinite" : "none",
          }}
        />
      </svg>
      <span className="hidden sm:inline">{isActive ? "EXIT" : "ENG"}</span>
      {isActive && (
        <span className="flex h-1.5 w-1.5 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981]" />
      )}
    </button>
  );
}
