import { Text, View, StyleSheet } from "react-native";
import { colors, statusColor } from "@/theme";

export function Badge({ label }: { label: string }) {
  const tone = statusColor(label);
  return (
    <View style={[styles.badge, { borderColor: tone }]}>
      <Text style={[styles.text, { color: tone }]}>{label.replace(/_/g, " ")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignSelf: "flex-start",
    backgroundColor: colors.bg,
  },
  text: { fontSize: 11, fontWeight: "600" },
});
