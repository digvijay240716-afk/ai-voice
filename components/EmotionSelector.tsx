import React from 'react';
import { Emotion } from '../types';

interface EmotionSelectorProps {
  selected?: Emotion;
  onSelect: (emotion: Emotion) => void;
  disabled?: boolean;
}

const emotions = [
  { label: 'Low', value: Emotion.Low, color: 'bg-slate-700' },
  { label: 'Stressed', value: Emotion.Stressed, color: 'bg-slate-700' },
  { label: 'Neutral', value: Emotion.Neutral, color: 'bg-slate-700' },
  { label: 'Good', value: Emotion.Good, color: 'bg-emerald-800' },
  { label: 'Overwhelmed', value: Emotion.Overwhelmed, color: 'bg-red-900' },
];

const EmotionSelector: React.FC<EmotionSelectorProps> = ({ selected, onSelect, disabled }) => {
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4 py-4 max-w-md mx-auto">
      {emotions.map((em) => (
        <button
          key={em.value}
          onClick={() => onSelect(em.value)}
          disabled={disabled}
          className={`
            px-4 py-2 rounded-full text-sm font-medium transition-all
            ${selected === em.value ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {em.label}
        </button>
      ))}
    </div>
  );
};

export default EmotionSelector;