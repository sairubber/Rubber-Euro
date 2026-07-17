import { useEffect } from "react";

export function useIsDark() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);
  return true;
}
