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
 *
 * ## Where the initial value comes from
 *
 * The switch is per-DEVICE, but the answer it starts from is per-RESTAURANT.
 * A device with no saved answer of its own adopts `gstEnabled` from the
 * restaurant root doc — what the owner told the setup wizard.
 *
 * Without that, the owner answered "we do not charge GST" during setup and
 * then every OTHER device in the building — the cashier's tablet, a waiter's
 * phone — carried on defaulting to ON and adding tax to its bills. Two
 * tablets billing the same table differently is the kind of bug a restaurant
 * discovers from a customer.
 *
 * Local still wins once it exists, because a device that has been switched
 * deliberately must not be overruled from elsewhere mid-service.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/features/auth/AuthContext";

const GST_ENABLED_KEY = "sada.settings.gstEnabled";

interface SettingsState {
  /** Charge GST on new bills. Defaults to true. */
  gstEnabled: boolean;
  setGstEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useAuth();
  const [gstEnabled, setGstEnabledState] = useState(true);
  /** This device has an answer of its own, so nothing may overrule it. */
  const [localAnswer, setLocalAnswer] = useState<boolean | null>(null);

  // Hydrate once from storage; absent key means "no answer here yet", which
  // is what lets the restaurant's answer apply below.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(GST_ENABLED_KEY)
      .then((raw) => {
        if (cancelled || raw === null) return;
        setLocalAnswer(raw === "true");
        setGstEnabledState(raw === "true");
      })
      .catch((e) => console.warn("[settings] failed to load:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // The owner's setup answer, for a device that has never been told
  // otherwise. Not persisted here: leaving the local key absent is what keeps
  // this device following the restaurant if the owner changes their mind.
  const restaurantGst = restaurant?.gstEnabled;
  useEffect(() => {
    if (localAnswer !== null || restaurantGst == null) return;
    setGstEnabledState(restaurantGst);
  }, [localAnswer, restaurantGst]);

  const setGstEnabled = (enabled: boolean) => {
    setGstEnabledState(enabled);
    setLocalAnswer(enabled);
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
