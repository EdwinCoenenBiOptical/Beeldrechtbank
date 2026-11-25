export type Drawing = {
  id: number | string;
  key?: string;
  title: string;
  preview: string;
  court: string;
  date: string;
  caseName: string;
  suspect: string;
  lawyer: string;
  keywords?: string[];
  isSample?: boolean;
  downloadAllowed?: boolean;
  crimeDate?: string;
  crimePlace?: string;
  crimeType?: string;
  crimeDescription?: string;
};
