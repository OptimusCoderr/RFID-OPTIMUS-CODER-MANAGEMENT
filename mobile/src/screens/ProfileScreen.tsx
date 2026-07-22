import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl, setApiBaseUrl, getBuildDefaultApiUrl } from "@/lib/config";
import { colors } from "@/theme";

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const [apiUrl, setApiUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getApiBaseUrl().then(setApiUrl);
  }, []);

  async function handleSave() {
    const trimmed = apiUrl.trim();
    const current = await getApiBaseUrl();
    await setApiBaseUrl(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Tokens were issued by the old server and won't verify against a
    // different one — sign out now rather than leaving every subsequent
    // request to fail with a confusing 401.
    if (trimmed.replace(/\/+$/, "") !== current.replace(/\/+$/, "")) await logout();
  }

  function handleLogout() {
    Alert.alert("Sign out", "Sign out of RFID Optimus?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logout() },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.fullName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role.replace(/_/g, " ")}</Text>
        {user?.company && <Text style={styles.company}>{user.company.name}</Text>}
      </View>

      <View>
        <Text style={styles.sectionTitle}>API server</Text>
        <Text style={styles.hint}>
          The address of your RFID Optimus backend — the same one the web dashboard talks to. Default: {getBuildDefaultApiUrl()}
        </Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.1.10:4000"
          placeholderTextColor={colors.textFaint}
        />
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>{saved ? "Saved" : "Save"}</Text>
        </Pressable>
        <Text style={styles.hint}>Changing this signs out the current session — sign in again against the new server.</Text>
      </View>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  name: { color: colors.text, fontSize: 18, fontWeight: "700" },
  email: { color: colors.textMuted, marginTop: 2 },
  role: { color: colors.accent, marginTop: 8, fontSize: 12, fontWeight: "600" },
  company: { color: colors.textFaint, marginTop: 2, fontSize: 12 },
  sectionTitle: { color: colors.text, fontWeight: "700", marginBottom: 4 },
  hint: { color: colors.textFaint, fontSize: 12, marginBottom: 8 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    color: colors.text,
    marginBottom: 8,
  },
  saveButton: { backgroundColor: colors.card, borderColor: colors.accent, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: "center", marginBottom: 8 },
  saveButtonText: { color: colors.accent, fontWeight: "600" },
  logoutButton: { borderColor: colors.danger, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: "center" },
  logoutText: { color: colors.danger, fontWeight: "700" },
});
