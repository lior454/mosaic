import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import JoinScreen from './screens/JoinScreen';
import UploadScreen from './screens/UploadScreen';

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

export type RootStackParamList = {
  Join: undefined;
  Upload: { eventId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Join">
        <Stack.Screen name="Join" component={JoinScreen} options={{ title: 'הצטרף לאירוע' }} />
        <Stack.Screen name="Upload" component={UploadScreen} options={{ title: 'העלה תוכן' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <StatusBar style="auto" />
      <AppNavigator />
    </ClerkProvider>
  );
}
