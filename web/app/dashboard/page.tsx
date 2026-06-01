'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Event {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string;
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

export default function Dashboard() {
  const { getToken } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await api.get('/api/events', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setEvents(res.data);
      } catch (err) {
        console.error('Failed to load events', err);
        setError('לא ניתן לטעון את האירועים. בדוק את החיבור לשרת.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">האירועים שלי</h1>
        <Link
          href="/dashboard/events/new"
          className="bg-black text-white px-6 py-2 rounded-lg hover:bg-gray-800 transition-colors"
        >
          + אירוע חדש
        </Link>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-center py-20">טוען...</p>
      ) : events.length === 0 ? (
        <p className="text-gray-400 text-center py-20">אין אירועים עדיין. צור את הראשון!</p>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <div className="bg-white border rounded-xl p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex justify-between items-start">
                  <h2 className="text-xl font-semibold">{event.name}</h2>
                  <span className={`text-sm px-3 py-1 rounded-full ${STATUS_COLORS[event.status] ?? 'bg-gray-100'}`}>
                    {STATUS_LABELS[event.status] ?? event.status}
                  </span>
                </div>
                <p className="text-gray-500 mt-2 text-sm">
                  {new Date(event.start_time).toLocaleString('he-IL')}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
