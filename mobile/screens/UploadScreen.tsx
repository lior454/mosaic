import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Image,
  Alert, ActivityIndicator,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import axios from 'axios';
import { api } from '../lib/api';
import { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Upload'>;

interface PickedAsset {
  uri: string;
  fileName: string;
  mimeType: string;
  type: 'photo' | 'video';
  status: 'pending' | 'uploading' | 'done' | 'error';
  mediaItemId?: string;
}

export default function UploadScreen({ route }: Props) {
  const { eventId } = route.params;
  const { getToken } = useAuth();
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  async function pickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאה נדרשת', 'Mosaic צריך גישה לגלריה');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.85,
      videoMaxDuration: 300,
    });
    if (result.canceled) return;
    const picked: PickedAsset[] = result.assets.map((a) => ({
      uri: a.uri,
      fileName: a.fileName ?? `media_${Date.now()}`,
      mimeType: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      type: a.type === 'video' ? 'video' : 'photo',
      status: 'pending',
    }));
    setAssets((prev) => [...prev, ...picked]);
  }

  async function uploadAll() {
    const pending = assets.filter((a) => a.status === 'pending');
    if (!pending.length) return;
    setUploading(true);
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };

    for (const asset of pending) {
      setAssets((prev) =>
        prev.map((a) => (a.uri === asset.uri ? { ...a, status: 'uploading' } : a))
      );
      try {
        // 1. Get signed upload URL
        const urlRes = await api.post(
          `/api/media/upload-url`,
          {
            event_id: eventId,
            file_name: asset.fileName,
            mime_type: asset.mimeType,
            type: asset.type,
            device_time: Date.now(),
          },
          { headers }
        );
        const { upload_url, media_item_id } = urlRes.data as { upload_url: string; media_item_id: string };

        // 2. Upload directly to R2
        const fileBlob = await fetch(asset.uri).then((r) => r.blob());
        await axios.put(upload_url, fileBlob, {
          headers: { 'Content-Type': asset.mimeType },
        });

        // 3. Confirm upload
        await api.post(`/api/media/${media_item_id}/confirm`, {}, { headers });

        setAssets((prev) =>
          prev.map((a) =>
            a.uri === asset.uri ? { ...a, status: 'done', mediaItemId: media_item_id } : a
          )
        );
      } catch (err) {
        console.error('Upload failed for', asset.fileName, err);
        setAssets((prev) =>
          prev.map((a) => (a.uri === asset.uri ? { ...a, status: 'error' } : a))
        );
      }
    }
    setUploading(false);
  }

  const pendingCount = assets.filter((a) => a.status === 'pending').length;
  const doneCount = assets.filter((a) => a.status === 'done').length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>העלה תוכן לאירוע</Text>
      {doneCount > 0 && (
        <Text style={styles.successBadge}>✓ {doneCount} קבצים הועלו בהצלחה</Text>
      )}

      <TouchableOpacity style={styles.pickButton} onPress={pickMedia} disabled={uploading}>
        <Text style={styles.pickButtonText}>+ בחר תמונות וסרטונים</Text>
      </TouchableOpacity>

      {assets.length > 0 && (
        <FlatList
          data={assets}
          keyExtractor={(item) => item.uri}
          numColumns={3}
          style={styles.grid}
          renderItem={({ item }) => (
            <View style={styles.thumbWrap}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
              <View style={[styles.badge, styles[`badge_${item.status}`]]}>
                <Text style={styles.badgeText}>
                  {item.status === 'done' ? '✓' :
                   item.status === 'uploading' ? '⬆' :
                   item.status === 'error' ? '✗' : '•'}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      {pendingCount > 0 && (
        <TouchableOpacity
          style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
          onPress={uploadAll}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadButtonText}>העלה {pendingCount} קבצים</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 8 },
  successBadge: { color: '#16a34a', fontSize: 14, marginBottom: 12 },
  pickButton: { backgroundColor: '#f3f4f6', borderRadius: 12, borderWidth: 2, borderColor: '#d1d5db', borderStyle: 'dashed', padding: 20, alignItems: 'center', marginBottom: 16 },
  pickButtonText: { color: '#374151', fontSize: 15, fontWeight: '500' },
  grid: { flex: 1, marginBottom: 16 },
  thumbWrap: { flex: 1 / 3, aspectRatio: 1, margin: 2, position: 'relative' },
  thumb: { flex: 1, borderRadius: 6 },
  badge: { position: 'absolute', bottom: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badge_pending: { backgroundColor: '#6b7280' },
  badge_uploading: { backgroundColor: '#f59e0b' },
  badge_done: { backgroundColor: '#16a34a' },
  badge_error: { backgroundColor: '#dc2626' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  uploadButton: { backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center' },
  uploadButtonDisabled: { opacity: 0.6 },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
} as const);
