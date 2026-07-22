import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { apiErrorMessage } from "@/lib/api";
import { colors } from "@/theme";

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not sign in"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>RFID Optimus</Text>
      <Text style={styles.subtitle}>Sign in to view your company's cards, holders, and attendance.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (submitting || !email || !password) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting || !email || !password}
      >
        {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>

      <Text style={styles.hint}>
        Uses the same account as the web dashboard. Point this app at your server's URL from Settings → API Server after
        signing in fails against the default.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24, gap: 12 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700", textAlign: "center" },
  subtitle: { color: colors.textMuted, textAlign: "center", marginBottom: 12 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
  },
  error: { color: colors.danger, textAlign: "center" },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#0f172a", fontWeight: "700" },
  hint: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 16 },
});
