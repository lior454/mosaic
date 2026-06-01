import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-8 py-4 flex justify-between items-center">
        <Link href="/dashboard" className="text-xl font-bold">🎬 Mosaic</Link>
        <UserButton />
      </nav>
      <main>{children}</main>
    </div>
  );
}
