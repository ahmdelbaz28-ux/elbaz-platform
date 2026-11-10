/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { FlaskConical } from "lucide-react";

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

export function EngineeringModeProvider({ children }: { readonly children: ReactNode }) {
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

  const contextValue = useMemo(() => ({ isActive, toggle }), [isActive, toggle]);

  return (
    <EngineeringModeContext.Provider value={contextValue}>
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
      aria-pressed={isActive}
      title={isActive
        ? "إيقاف الوضع الهندسي — Turn OFF Engineering Mode"
        : "الوضع الهندسي — Turn ON Engineering Mode"}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 ${
        isActive
          ? "bg-[rgba(16,185,129,0.15)] text-[#10b981] shadow-[0_0_12px_rgba(16,185,129,0.35)] ring-1 ring-[#10b981]"
          : "bg-transparent text-[#475569] hover:bg-white/5 hover:text-[#06b6d4]"
      }`}
    >
      {/* Flask icon — deliberately a ROUND icon button so it can never be
          mistaken for the language pill (a rounded-rectangle with text). */}
      <FlaskConical className="h-4 w-4" aria-hidden="true" />
      {isActive && (
        <span className="absolute -end-0.5 -top-0.5 flex h-2 w-2 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981]" />
      )}
    </button>
  );
}
