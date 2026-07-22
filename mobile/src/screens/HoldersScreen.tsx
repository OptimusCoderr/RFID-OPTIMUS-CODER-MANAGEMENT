import { useState } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api";
import { colors } from "@/theme";
import type { CardHolder } from "@/types";

export function HoldersScreen() {
  const [search, setSearch] = useState("");

  // Unlike /cards and /attendance, GET /holders returns a bare array (no
  // pagination envelope) — capped via `limit`, not `page`/`pageSize`.
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["holders", search],
    queryFn: async () => (await api.get<CardHolder[]>("/holders", { params: { search: search || undefined, limit: 50 } })).data,
  });

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search name, email, employee ID..."
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />

      {isLoading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />}
      {error && <Text style={styles.error}>{apiErrorMessage(error, "Could not load holders")}</Text>}

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        refreshing={isFetching}
        onRefresh={refetch}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={!isLoading ? <Text style={styles.muted}>No holders found.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.fullName}</Text>
              <Text style={styles.rowSubtitle}>
                {item.department ?? "No department"} {item.employeeId ? `· ${item.employeeId}` : ""}
              </Text>
            </View>
            <Text style={styles.cardCount}>{item._count?.cards ?? 0} card{item._count?.cards === 1 ? "" : "s"}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  search: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    color: colors.text,
    marginBottom: 12,
  },
  muted: { color: colors.textFaint, textAlign: "center", marginTop: 24 },
  error: { color: colors.danger, marginBottom: 8 },
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
  cardCount: { color: colors.textFaint, fontSize: 12 },
});
