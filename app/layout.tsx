import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {title: 'Beeldrechtbank — Nicole van den Hout', description: 'Rechtbanktekeningen voor redacties'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="nl"><body>{children}</body></html>}
