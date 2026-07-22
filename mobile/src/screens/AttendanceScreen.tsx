import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { colors } from "@/theme";
import type { AttendanceRecord, PaginatedResponse } from "@/types";

export function AttendanceScreen() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["attendance"],
    queryFn: async () =>
      (await api.get<PaginatedResponse<AttendanceRecord>>("/attendance", { params: { pageSize: 50 } })).data,
  });

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />}
      {error && <Text style={styles.error}>{apiErrorMessage(error, "Could not load attendance records")}</Text>}

      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        refreshing={isFetching}
        onRefresh={refetch}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ListEmptyComponent={!isLoading ? <Text style={styles.muted}>No attendance records yet.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.holder?.fullName ?? "Unknown holder"}</Text>
              <Text style={styles.rowSubtitle}>
                {item.sessionLabel ?? item.zone?.name ?? "General"}
                {item.manualEntry ? " · manual" : ""} · {format(new Date(item.recordedAt), "PP p")}
              </Text>
            </View>
            <Badge label={item.type} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.textFaint, textAlign: "center", marginTop: 24 },
  error: { color: colors.danger, marginHorizontal: 16, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
