'use client';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import Link from 'next/link';
import QRCode from 'qrcode';

interface Event {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string;
  invite_link: string;
  qr_code: string;
  lat: number | null;
  lng: number | null;
}

interface MediaItem {
  id: string;
  uploader_id: string;
  type: string;
  status: string;
  synced_timestamp: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  upcoming: 'קרוב',
  live: 'פעיל',
  ended: 'הסתיים',
};

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-800',
  live: 'bg-green-100 text-green-800',
  ended: 'bg-gray-100 text-gray-600',
};

export default function EventPage({ params }: { params: { id: string } }) {
  const { getToken } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const joinUrl = event
    ? `${window?.location?.origin ?? ''}/join/${event.invite_link}`
    : '';

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [eventRes, mediaRes] = await Promise.all([
          api.get(`/api/events/${params.id}`, { headers }),
          api.get(`/api/media/event/${params.id}`, { headers }),
        ]);
        setEvent(eventRes.data);
        setMedia(mediaRes.data);
      } catch (err) {
        console.error(err);
        setError('לא ניתן לטעון את פרטי האירוע');
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  useEffect(() => {
    if (event && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, joinUrl, { width: 200, margin: 2 });
    }
  }, [event, joinUrl]);

  async function copyLink() {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return <p className="text-gray-400 text-center py-20">טוען...</p>;
  }

  if (error || !event) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error || 'אירוע לא נמצא'}
        </div>
      </div>
    );
  }

  const uploadedCount = media.filter((m) => m.status === 'uploaded').length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-start mb-8">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-black mb-1 block">
            ← האירועים שלי
          </Link>
          <h1 className="text-3xl font-bold">{event.name}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {new Date(event.start_time).toLocaleString('he-IL')} —{' '}
            {new Date(event.end_time).toLocaleString('he-IL')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm px-3 py-1 rounded-full ${STATUS_COLORS[event.status] ?? 'bg-gray-100'}`}>
            {STATUS_LABELS[event.status] ?? event.status}
          </span>
          {uploadedCount > 0 && (
            <Link
              href={`/dashboard/events/${event.id}/editor`}
              className="bg-black text-white px-5 py-2 rounded-lg hover:bg-gray-800 transition-colors text-sm"
            >
              עורך וידאו
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* QR Code Card */}
        <div className="bg-white border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">הזמן משתתפים</h2>
          <div className="flex flex-col items-center gap-4">
            <canvas ref={qrCanvasRef} className="rounded-lg" />
            <p className="text-xs text-gray-400 text-center break-all">{joinUrl}</p>
            <button
              onClick={copyLink}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {copied ? '✓ הועתק!' : 'העתק קישור הצטרפות'}
            </button>
          </div>
        </div>

        {/* Stats Card */}
        <div className="bg-white border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">סטטיסטיקות</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600 text-sm">סה״כ קבצים</span>
              <span className="font-semibold">{media.length}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600 text-sm">הועלו בהצלחה</span>
              <span className="font-semibold text-green-600">{uploadedCount}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600 text-sm">ממתינים לעיבוד</span>
              <span className="font-semibold text-yellow-600">
                {media.filter((m) => m.status === 'pending').length}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-600 text-sm">סוגי תוכן</span>
              <span className="font-semibold">
                {media.filter((m) => m.type === 'video').length} וידאו ·{' '}
                {media.filter((m) => m.type === 'photo').length} תמונות
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Media List */}
      {media.length > 0 && (
        <div className="bg-white border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">תוכן שהועלה ({media.length})</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {media.map((item) => (
              <div key={item.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{item.type === 'video' ? '🎥' : '📷'}</span>
                  <span className="text-gray-600 font-mono text-xs">{item.id.slice(0, 8)}…</span>
                  {item.synced_timestamp && (
                    <span className="text-gray-400 text-xs">
                      {new Date(item.synced_timestamp).toLocaleTimeString('he-IL')}
                    </span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  item.status === 'uploaded' ? 'bg-green-100 text-green-700' :
                  item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {item.status === 'uploaded' ? 'הועלה' : item.status === 'pending' ? 'ממתין' : item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
