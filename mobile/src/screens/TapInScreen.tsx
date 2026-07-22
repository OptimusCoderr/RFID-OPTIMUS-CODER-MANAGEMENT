import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Nfc } from "lucide-react-native";
import { api, apiErrorMessage } from "@/lib/api";
import { isNfcSupported, readTagUid, cancelRead, NfcCancelledError } from "@/lib/nfc";
import { colors } from "@/theme";
import type { AccessZone, AttendanceRecord, Card, PaginatedResponse } from "@/types";

type TapResult =
  | { kind: "success"; record: AttendanceRecord }
  | { kind: "error"; message: string; uid?: string };

// Reads a physical card's UID over NFC and records a tap the same way a
// desktop encoder does — POST /api/attendance with the resolved cardId.
// Unlike the desktop agent, this never authenticates with a stored key or
// touches card memory, so there's no write-protect/key-management surface
// here: it's purely "whose card is this, log a check-in/out for them."
export function TapInScreen() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [history, setHistory] = useState<TapResult[]>([]);
  const scanToken = useRef(0);

  useEffect(() => {
    isNfcSupported().then(setSupported);
  }, []);

  const { data: zones } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await api.get<AccessZone[]>("/zones")).data,
  });

  async function handleScan() {
    const token = ++scanToken.current;
    setScanning(true);
    try {
      const uid = await readTagUid();
      if (token !== scanToken.current) return; // superseded by a cancel/new scan

      const { data: found } = await api.get<PaginatedResponse<Card>>("/cards", { params: { search: uid, pageSize: 5 } });
      const card = found.data.find((c) => c.uid.toUpperCase() === uid);
      if (!card) {
        setHistory((prev) => [{ kind: "error", message: "No card registered with this UID", uid }, ...prev]);
        return;
      }

      const { data: record } = await api.post<AttendanceRecord>("/attendance", {
        cardId: card.id,
        zoneId: zoneId ?? undefined,
      });
      setHistory((prev) => [{ kind: "success", record }, ...prev]);
    } catch (err) {
      if (err instanceof NfcCancelledError) return;
      setHistory((prev) => [{ kind: "error", message: apiErrorMessage(err, "Could not record this tap") }, ...prev]);
    } finally {
      if (token === scanToken.current) setScanning(false);
    }
  }

  function handleCancel() {
    scanToken.current++; // any in-flight handleScan's result is now stale
    cancelRead();
    setScanning(false);
  }

  if (supported === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!supported) {
    return (
      <View style={styles.centered}>
        <Nfc size={40} color={colors.textFaint} />
        <Text style={styles.unsupportedTitle}>NFC isn't available</Text>
        <Text style={styles.unsupportedBody}>
          This device has no NFC hardware, or this build doesn't include it — Expo Go doesn't bundle the NFC module, so
          this screen only works in a custom dev-client build (see mobile/README.md).
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {zones && zones.length > 0 && (
        <View style={styles.zoneRow}>
          <Text style={styles.zoneLabel}>Zone</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable style={[styles.zoneChip, zoneId === null && styles.zoneChipActive]} onPress={() => setZoneId(null)}>
              <Text style={[styles.zoneChipText, zoneId === null && styles.zoneChipTextActive]}>General</Text>
            </Pressable>
            {zones.map((z) => (
              <Pressable key={z.id} style={[styles.zoneChip, zoneId === z.id && styles.zoneChipActive]} onPress={() => setZoneId(z.id)}>
                <Text style={[styles.zoneChipText, zoneId === z.id && styles.zoneChipTextActive]}>{z.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.scanArea}>
        <Pressable
          style={[styles.scanButton, scanning && styles.scanButtonActive]}
          onPress={scanning ? handleCancel : handleScan}
        >
          {scanning ? <ActivityIndicator color={colors.text} /> : <Nfc size={36} color={colors.bg} />}
        </Pressable>
        <Text style={styles.scanHint}>{scanning ? "Hold the card near your device… (tap to cancel)" : "Tap to scan a card"}</Text>
      </View>

      <ScrollView style={styles.history} contentContainerStyle={{ paddingBottom: 24 }}>
        {history.map((item, i) => (
          <View key={i} style={[styles.historyRow, item.kind === "error" ? styles.historyRowError : styles.historyRowSuccess]}>
            {item.kind === "success" ? (
              <>
                <Text style={styles.historyTitle}>
                  {item.record.holder?.fullName ?? "Unknown holder"} — {item.record.type.replace("_", " ")}
                </Text>
                <Text style={styles.historySubtitle}>{item.record.card?.label ?? item.record.card?.uid}</Text>
              </>
            ) : (
              <>
                <Text style={styles.historyTitle}>{item.message}</Text>
                {item.uid && <Text style={styles.historySubtitle}>UID {item.uid}</Text>}
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  unsupportedTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  unsupportedBody: { color: colors.textMuted, textAlign: "center", fontSize: 13 },
  zoneRow: { marginBottom: 16 },
  zoneLabel: { color: colors.textFaint, fontSize: 12, marginBottom: 6 },
  zoneChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
  },
  zoneChipActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  zoneChipText: { color: colors.textMuted, fontSize: 13 },
  zoneChipTextActive: { color: colors.bg, fontWeight: "700" },
  scanArea: { alignItems: "center", justifyContent: "center", paddingVertical: 28, gap: 12 },
  scanButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonActive: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.accent },
  scanHint: { color: colors.textMuted, fontSize: 13 },
  history: { flex: 1 },
  historyRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  historyRowSuccess: { backgroundColor: colors.card, borderColor: colors.border },
  historyRowError: { backgroundColor: colors.card, borderColor: colors.danger },
  historyTitle: { color: colors.text, fontWeight: "600" },
  historySubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
