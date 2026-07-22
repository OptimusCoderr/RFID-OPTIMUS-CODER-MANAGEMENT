import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { api, apiErrorMessage } from "@/lib/api";
import { colors } from "@/theme";
import type { AppNotification } from "@/types";

export function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () =>
      (await api.get<{ data: AppNotification[]; unreadCount: number }>("/notifications")).data,
  });
  const notifications = data?.data ?? [];

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <Pressable style={styles.markAllButton} onPress={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          <Text style={styles.markAllText}>Mark all {unreadCount} as read</Text>
        </Pressable>
      )}

      {isLoading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />}
      {error && <Text style={styles.error}>{apiErrorMessage(error, "Could not load notifications")}</Text>}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        refreshing={isFetching}
        onRefresh={refetch}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ListEmptyComponent={!isLoading ? <Text style={styles.muted}>No notifications.</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, !item.readAt && styles.rowUnread]}
            onPress={() => !item.readAt && markRead.mutate(item.id)}
          >
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowMessage}>{item.message}</Text>
            <Text style={styles.rowTime}>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.textFaint, textAlign: "center", marginTop: 24 },
  error: { color: colors.danger, marginHorizontal: 16, marginTop: 12 },
  markAllButton: { padding: 12, alignItems: "center" },
  markAllText: { color: colors.accent, fontWeight: "600" },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowUnread: { borderColor: colors.accent },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowMessage: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  rowTime: { color: colors.textFaint, fontSize: 11, marginTop: 6 },
});
