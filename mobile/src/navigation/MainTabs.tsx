import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LayoutDashboard, CreditCard, Users, ClipboardList, Bell, UserCircle } from "lucide-react-native";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { CardsScreen } from "@/screens/CardsScreen";
import { HoldersScreen } from "@/screens/HoldersScreen";
import { AttendanceScreen } from "@/screens/AttendanceScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";

const Tab = createBottomTabNavigator();

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f1f5f9",
        tabBarStyle: { backgroundColor: "#0f172a", borderTopColor: "#1e293b" },
        tabBarActiveTintColor: "#38bdf8",
        tabBarInactiveTintColor: "#64748b",
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Cards"
        component={CardsScreen}
        options={{ tabBarIcon: ({ color, size }) => <CreditCard color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Holders"
        component={HoldersScreen}
        options={{ tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ tabBarIcon: ({ color, size }) => <Bell color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ color, size }) => <UserCircle color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
