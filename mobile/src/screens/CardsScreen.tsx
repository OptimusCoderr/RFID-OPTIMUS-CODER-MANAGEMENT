import { useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { colors } from "@/theme";
import type { Card, PaginatedResponse } from "@/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";

export function CardsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["cards", search],
    queryFn: async () =>
      (await api.get<PaginatedResponse<Card>>("/cards", { params: { search: search || undefined, pageSize: 50 } })).data,
  });

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search UID, label, holder..."
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />

      {isLoading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />}
      {error && <Text style={styles.error}>{apiErrorMessage(error, "Could not load cards")}</Text>}

      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        refreshing={isFetching}
        onRefresh={refetch}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={!isLoading ? <Text style={styles.muted}>No cards found.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate("CardDetail", { card: item })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.label || item.uid}</Text>
              <Text style={styles.rowSubtitle}>
                {item.uid} {item.holder ? `· ${item.holder.fullName}` : ""}
              </Text>
            </View>
            <Badge label={item.status} />
          </Pressable>
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
});
