'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import TimelineEditor, { Clip } from '@/components/TimelineEditor';
import Link from 'next/link';

export default function EditorPage({ params }: { params: { id: string } }) {
  const { getToken } = useAuth();
  const [clips, setClips] = useState<Clip[]>([]);
  const [mediaMap, setMediaMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [projectRes, mediaRes] = await Promise.all([
          api.get(`/api/edit/${params.id}`, { headers }),
          api.get(`/api/media/event/${params.id}`, { headers }),
        ]);

        const map = Object.fromEntries(
          (mediaRes.data as { id: string; download_url: string }[]).map((m) => [m.id, m.download_url])
        );
        setMediaMap(map);

        const clipsWithUrls: Clip[] = (projectRes.data.timeline_json.clips as Clip[]).map((c) => ({
          ...c,
          download_url: map[c.media_item_id],
        }));

        setClips(clipsWithUrls);
      } catch (err) {
        console.error(err);
        setError('לא ניתן לטעון את פרויקט העריכה');
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  function handleClipChange(index: number, newMediaId: string) {
    setClips((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        const chosenAlt = c.alternatives.find((a) => a.media_item_id === newMediaId);
        if (!chosenAlt) return c;
        return {
          ...c,
          media_item_id: newMediaId,
          synced_timestamp: chosenAlt.synced_timestamp,
          alternatives: [
            ...c.alternatives.filter((a) => a.media_item_id !== newMediaId),
            { media_item_id: c.media_item_id, synced_timestamp: c.synced_timestamp },
          ],
          download_url: mediaMap[newMediaId],
        };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      await api.patch(
        `/api/edit/${params.id}`,
        { timeline_json: { clips: clips.map(({ download_url: _url, ...c }) => c) } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error(err);
      setError('שגיאה בשמירה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportStatus('');
    try {
      const token = await getToken();
      await api.post(`/api/export/${params.id}`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setExportStatus('הייצוא התחיל! נודיע לך כשהסרטון יהיה מוכן.');
    } catch (err) {
      console.error(err);
      setExportStatus('שגיאה בייצוא. נסה שוב.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <Link href={`/dashboard/events/${params.id}`} className="text-sm text-gray-500 hover:text-black mb-1 block">
            ← חזרה לאירוע
          </Link>
          <h1 className="text-3xl font-bold">עורך וידאו</h1>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || clips.length === 0}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {exporting ? 'מייצא...' : 'ייצא סרטון'}
        </button>
      </div>

      {exportStatus && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          {exportStatus}
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-center py-20">טוען...</p>
      ) : clips.length === 0 ? (
        <p className="text-gray-400 text-center py-20">ממתין לתוכן מהמשתתפים...</p>
      ) : (
        <TimelineEditor
          clips={clips}
          onClipChange={handleClipChange}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}
