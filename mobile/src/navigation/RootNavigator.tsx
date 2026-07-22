import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { LoginScreen } from "@/screens/LoginScreen";
import { MainTabs } from "@/navigation/MainTabs";
import { CardDetailScreen } from "@/screens/CardDetailScreen";
import type { Card } from "@/types";

export type RootStackParamList = {
  Main: undefined;
  CardDetail: { card: Card };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a" }}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f1f5f9" }}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: "Card" }} />
    </Stack.Navigator>
  );
}
