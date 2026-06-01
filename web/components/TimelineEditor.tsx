'use client';
import { useEffect, useRef, useState } from 'react';

export interface Clip {
  media_item_id: string;
  synced_timestamp: string | null;
  duration: number;
  alternatives: { media_item_id: string; synced_timestamp: string | null }[];
  download_url?: string;
}

interface Props {
  clips: Clip[];
  onClipChange: (index: number, newMediaId: string) => void;
  onSave: () => Promise<void>;
  saving?: boolean;
}

export default function TimelineEditor({ clips, onClipChange, onSave, saving }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentClip = clips[currentIndex];

  useEffect(() => {
    if (videoRef.current && currentClip?.download_url) {
      videoRef.current.src = currentClip.download_url;
      videoRef.current.load();
    }
  }, [currentIndex, currentClip?.download_url]);

  function formatTime(ts: string | null) {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Video preview */}
      <div className="bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center">
        {currentClip?.download_url ? (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            playsInline
          />
        ) : (
          <p className="text-gray-500 text-sm">אין תצוגה מקדימה</p>
        )}
      </div>

      {/* Timeline strip */}
      <div className="flex gap-2 overflow-x-auto p-3 bg-gray-100 rounded-xl min-h-[80px] items-center">
        {clips.map((clip, i) => (
          <button
            key={`${clip.media_item_id}-${i}`}
            onClick={() => setCurrentIndex(i)}
            className={`flex-shrink-0 w-24 h-16 rounded-lg border-2 overflow-hidden relative bg-gray-200 flex flex-col items-center justify-center transition-all
              ${i === currentIndex ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-gray-300'}`}
          >
            <span className="text-xs text-gray-600 font-mono">{formatTime(clip.synced_timestamp)}</span>
            {clip.alternatives.length > 0 && (
              <span className="absolute top-1 right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {clip.alternatives.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Alternatives for current clip */}
      {currentClip && currentClip.alternatives.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm font-medium text-blue-800 mb-3">
            זוויות נוספות בנקודת זמן זו ({currentClip.alternatives.length}):
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onClipChange(currentIndex, currentClip.media_item_id)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium"
            >
              נוכחי ✓
            </button>
            {currentClip.alternatives.map((alt) => (
              <button
                key={alt.media_item_id}
                onClick={() => onClipChange(currentIndex, alt.media_item_id)}
                className="px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm hover:bg-blue-100 transition-colors"
              >
                {formatTime(alt.synced_timestamp)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={onSave}
        disabled={saving}
        className="bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? 'שומר...' : 'שמור עריכה'}
      </button>
    </div>
  );
}
