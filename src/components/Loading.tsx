import { ActivityIndicator, View } from "react-native";
import { colors } from "@/theme/theme";

export function Loading() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bg,
      }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
