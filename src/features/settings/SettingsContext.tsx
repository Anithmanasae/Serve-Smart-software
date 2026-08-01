/**
 * Device-local app settings (AsyncStorage-persisted).
 *
 * Currently just the GST switch: when OFF, newly generated bills carry zero
 * CGST/SGST and the grand total equals the taxable amount. Bills that were
 * already created keep whatever tax they were stored with — the setting only
 * affects bill creation, never money math on existing docs.
 *
 * This is a billing preference, not a security boundary: Firestore rules
 * validate GST consistency (gstTotal == cgst + sgst) either way.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const GST_ENABLED_KEY = "sada.settings.gstEnabled";

interface SettingsState {
  /** Charge GST on new bills. Defaults to true. */
  gstEnabled: boolean;
  setGstEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [gstEnabled, setGstEnabledState] = useState(true);

  // Hydrate once from storage; absent key means the default (on).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(GST_ENABLED_KEY)
      .then((raw) => {
        if (!cancelled && raw !== null) setGstEnabledState(raw === "true");
      })
      .catch((e) => console.warn("[settings] failed to load:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  const setGstEnabled = (enabled: boolean) => {
    setGstEnabledState(enabled);
    AsyncStorage.setItem(GST_ENABLED_KEY, String(enabled)).catch((e) =>
      console.warn("[settings] failed to persist:", e)
    );
  };

  return (
    <SettingsContext.Provider value={{ gstEnabled, setGstEnabled }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
