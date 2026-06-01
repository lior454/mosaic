import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as Location from 'expo-location';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../lib/api';
import { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Join'>;

export default function JoinScreen({ navigation }: Props) {
  const { getToken } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!code.trim()) {
      Alert.alert('שגיאה', 'הכנס קוד הזמנה');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      // Resolve invite code to event id
      const resolveRes = await api.get(`/api/events/join/${code.trim()}`, { headers });
      const event = resolveRes.data;

      // Send clock delta
      await api.post(
        `/api/events/${event.id}/join`,
        { device_time: Date.now() },
        { headers }
      );

      navigation.navigate('Upload', { eventId: event.id });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      Alert.alert('שגיאה', msg ?? 'לא ניתן להצטרף לאירוע');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinNearby() {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('הרשאה נדרשת', 'Mosaic צריך גישה למיקום כדי למצוא אירועים קרובים');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const token = await getToken();
      const res = await api.get('/api/events/nearby', {
        headers: { Authorization: `Bearer ${token}` },
        params: { lat: loc.coords.latitude, lng: loc.coords.longitude, radius: 500 },
      });
      const events: { id: string; name: string }[] = res.data;
      if (!events.length) {
        Alert.alert('לא נמצאו אירועים', 'אין אירועים פעילים בקרבת מקום');
        return;
      }
      if (events.length === 1) {
        await api.post(
          `/api/events/${events[0].id}/join`,
          { device_time: Date.now() },
          { headers: { Authorization: `Bearer ${await getToken()}` } }
        );
        navigation.navigate('Upload', { eventId: events[0].id });
        return;
      }
      // Multiple events — let user pick
      Alert.alert(
        'בחר אירוע',
        'נמצאו מספר אירועים קרובים',
        events.slice(0, 3).map((e) => ({
          text: e.name,
          onPress: async () => {
            const t = await getToken();
            await api.post(`/api/events/${e.id}/join`, { device_time: Date.now() }, {
              headers: { Authorization: `Bearer ${t}` },
            });
            navigation.navigate('Upload', { eventId: e.id });
          },
        }))
      );
    } catch (err) {
      Alert.alert('שגיאה', 'לא ניתן למצוא אירועים קרובים');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mosaic</Text>
      <Text style={styles.subtitle}>הצטרף לאירוע ושתף את הרגעים שלך</Text>

      <View style={styles.card}>
        <Text style={styles.label}>קוד הזמנה</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="הדבק קוד או קישור הזמנה"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.button} onPress={handleJoin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>הצטרף</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.nearbyButton} onPress={handleJoinNearby} disabled={loading}>
        <Text style={styles.nearbyButtonText}>📍 מצא אירוע קרוב אוטומטית</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, fontWeight: '800', color: '#111', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6b7280', marginBottom: 40, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16, backgroundColor: '#f9fafb' },
  button: { backgroundColor: '#111', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  nearbyButton: { marginTop: 20, padding: 14, alignItems: 'center' },
  nearbyButtonText: { color: '#6b7280', fontSize: 15 },
});
