/**
 * Account tab card: edit what prints on the receipt header (restaurant name +
 * address line). Lives on the restaurants/{id} root doc so every device in
 * the restaurant prints the same identity — this is how the software is
 * resold: each deployment sets its own name here.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius, shadow, space } from "@/theme/theme";
import {
  saveRestaurantProfile,
  useRestaurantProfile,
} from "./useRestaurantProfile";

export function ReceiptDetailsCard() {
  const { data: profile, loading } = useRestaurantProfile();

  const [name, setName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate from the live doc until the user starts editing.
  useEffect(() => {
    if (!dirty && profile) {
      setName(profile.name ?? "");
      setAddressLine(profile.addressLine ?? "");
    }
  }, [profile, dirty]);

  const canSave = dirty && !saving && name.trim().length > 0;

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await saveRestaurantProfile(name, addressLine);
      setDirty(false);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Receipt Details</Text>
      <Text style={styles.hint}>
        Printed at the top of every customer bill
      </Text>

      <Text style={styles.label}>Restaurant Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(t) => {
          setName(t);
          setDirty(true);
        }}
        placeholder={loading ? "Loading…" : "e.g. SADA Restaurant"}
        placeholderTextColor={colors.textMuted}
        maxLength={60}
        editable={!saving}
      />

      <Text style={styles.label}>Address Line</Text>
      <TextInput
        style={styles.input}
        value={addressLine}
        onChangeText={(t) => {
          setAddressLine(t);
          setDirty(true);
        }}
        placeholder="e.g. 12 MG Road, Bengaluru"
        placeholderTextColor={colors.textMuted}
        maxLength={80}
        editable={!saving}
      />

      <Pressable
        style={({ pressed }) => [
          styles.saveBtn,
          !canSave && styles.saveBtnDisabled,
          pressed && styles.pressed,
        ]}
        onPress={onSave}
        disabled={!canSave}
      >
        {saving ? (
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          <Text style={styles.saveBtnText}>
            {dirty ? "Save Receipt Details" : "Saved"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    gap: space.s2,
    ...shadow.card,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hint: { fontSize: 13, color: colors.textMuted },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginTop: space.s2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  saveBtn: {
    marginTop: space.s3,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: colors.borderStrong },
  saveBtnText: { color: colors.textInverse, fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
