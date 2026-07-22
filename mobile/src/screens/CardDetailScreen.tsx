import { View, Text, ScrollView, StyleSheet } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { format } from "date-fns";
import { Badge } from "@/components/Badge";
import { colors } from "@/theme";
import type { RootStackParamList } from "@/navigation/RootNavigator";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

// Read-only by design — this companion app is for looking things up on the
// go, not for the write-protect/key/assignment operations that need the
// desktop app's USB encoder anyway. See mobile/README.md.
export function CardDetailScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, "CardDetail">>();
  const { card } = params;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 4 }}>
      <View style={styles.header}>
        <Text style={styles.title}>{card.label || card.uid}</Text>
        <Badge label={card.status} />
      </View>

      <Field label="UID" value={card.uid} />
      <Field label="Card type" value={card.cardType.replace(/_/g, " ")} />
      <Field label="Write protected" value={card.writeProtected ? "Yes" : "No"} />
      <Field label="Key on file" value={card.hasStoredKeys ? "Yes" : "No"} />
      {card.holder && <Field label="Holder" value={card.holder.fullName} />}
      {card.template && <Field label="Template" value={card.template.name} />}
      {card.issuedAt && <Field label="Issued" value={format(new Date(card.issuedAt), "PP")} />}
      {card.expiresAt && <Field label="Expires" value={format(new Date(card.expiresAt), "PP")} />}
      {card.lastSeenAt && <Field label="Last seen" value={format(new Date(card.lastSeenAt), "PPp")} />}
      {card.notes && <Field label="Notes" value={card.notes} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", flexShrink: 1 },
  field: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  fieldLabel: { color: colors.textFaint, fontSize: 12 },
  fieldValue: { color: colors.text, fontSize: 15, marginTop: 2 },
});
