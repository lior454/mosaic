'use client';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function NewEvent() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    start_time: '',
    end_time: '',
    lat: '',
    lng: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await api.post(
        '/api/events',
        {
          name: form.name,
          start_time: new Date(form.start_time).toISOString(),
          end_time: new Date(form.end_time).toISOString(),
          lat: form.lat ? Number(form.lat) : undefined,
          lng: form.lng ? Number(form.lng) : undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      router.push(`/dashboard/events/${res.data.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה ביצירת האירוע';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">אירוע חדש</h1>
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">שם האירוע</label>
          <input
            required
            placeholder="חתונה של דנה ויוסי"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-lg p-3 text-right focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">התחלה</label>
            <input
              required
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              className="w-full border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">סיום</label>
            <input
              required
              type="datetime-local"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              className="w-full border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">קו רוחב (אופציונלי)</label>
            <input
              placeholder="32.0853"
              value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })}
              className="w-full border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">קו אורך (אופציונלי)</label>
            <input
              placeholder="34.7818"
              value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })}
              className="w-full border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-black text-white py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {submitting ? 'יוצר...' : 'צור אירוע'}
        </button>
      </form>
    </div>
  );
}
