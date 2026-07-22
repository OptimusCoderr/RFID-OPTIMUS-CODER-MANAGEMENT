import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";
import type { DashboardStats } from "@/types";

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export function DashboardScreen() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => (await api.get<DashboardStats>("/dashboard/stats")).data,
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
    >
      <Text style={styles.greeting}>Hi, {user?.fullName?.split(" ")[0] ?? "there"}</Text>
      <Text style={styles.company}>{user?.company?.name ?? "No company"}</Text>

      {isLoading && <Text style={styles.muted}>Loading...</Text>}
      {error && <Text style={styles.error}>{apiErrorMessage(error, "Could not load dashboard stats")}</Text>}

      {data && (
        <>
          <View style={styles.grid}>
            <StatTile label="Total cards" value={data.totalCards} />
            <StatTile label="Currently present" value={data.currentlyPresent} />
            <StatTile label="Total holders" value={data.totalHolders} />
            <StatTile label="Encoders online" value={data.encodersByStatus?.ONLINE ?? 0} />
            <StatTile label="Open maintenance" value={data.openMaintenanceTickets} />
            <StatTile label="Active visitor passes" value={data.activeVisitorPasses} />
          </View>

          <Text style={styles.sectionTitle}>Recent activity</Text>
          {data.recentActivity.length === 0 && <Text style={styles.muted}>No recent activity.</Text>}
          {data.recentActivity.map((log) => (
            <View key={log.id} style={styles.activityRow}>
              <Text style={styles.activityText} numberOfLines={1}>
                {log.operationType.replace(/_/g, " ")} {log.card ? `· ${log.card.label ?? log.card.uid}` : ""}
              </Text>
              <Text style={styles.activityTime}>{formatDistanceToNow(new Date(log.performedAt), { addSuffix: true })}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 8 },
  greeting: { color: colors.text, fontSize: 22, fontWeight: "700" },
  company: { color: colors.textMuted, marginBottom: 16 },
  muted: { color: colors.textFaint },
  error: { color: colors.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    width: "47%",
  },
  tileValue: { color: colors.text, fontSize: 24, fontWeight: "700" },
  tileLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 20, marginBottom: 8 },
  activityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  activityText: { color: colors.text, flex: 1 },
  activityTime: { color: colors.textFaint, fontSize: 12 },
});
