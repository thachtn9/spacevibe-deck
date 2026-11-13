export interface TextDocument {
  id: string;
  path: string | null;
  name: string;
  content: string;
  savedContent: string;
  fingerprint: string | null;
}
export interface TextWorkspace {
  version: 1;
  active: string | null;
  documents: TextDocument[];
  wrap: boolean;
  fontSize: number;
}
