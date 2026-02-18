export enum Emotion {
  Low = 'Low',
  Stressed = 'Stressed',
  Neutral = 'Neutral',
  Good = 'Good',
  Overwhelmed = 'Overwhelmed',
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'model' | 'system';
  text?: string;
  image?: string; // Base64 data URI
  isThinking?: boolean;
};

export interface GeoLocation {
  latitude: number;
  longitude: number;
}
