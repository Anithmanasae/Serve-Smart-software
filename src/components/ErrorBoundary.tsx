/**
 * Root error boundary — catches any render/runtime crash in the tree below
 * and shows a friendly recovery screen instead of a white screen / red box.
 */
import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "@/theme/theme";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface in dev logs; a crash-reporting hook can be added here later.
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The screen hit an unexpected error. Your data is safe — try again, or
          restart the app if this keeps happening.
        </Text>
        {__DEV__ && (
          <Text style={styles.detail} numberOfLines={4}>
            {this.state.error.message}
          </Text>
        )}
        <Pressable
          style={styles.button}
          onPress={() => this.setState({ error: null })}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: space.s6,
    gap: space.s3,
  },
  emoji: { fontSize: 40 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  message: {
    textAlign: "center",
    color: colors.textMuted,
    lineHeight: 20,
  },
  detail: {
    marginTop: space.s2,
    fontSize: 12,
    color: colors.danger,
    textAlign: "center",
  },
  button: {
    marginTop: space.s4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    paddingHorizontal: space.s6,
  },
  buttonText: { color: colors.textInverse, fontWeight: "700", fontSize: 16 },
});
