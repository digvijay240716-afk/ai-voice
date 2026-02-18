import React from 'react';

interface ControlBarProps {
  onMicClick: () => void;
  onTypeClick: () => void;
  onToolsClick: () => void;
  isMicActive: boolean;
  disabled?: boolean;
}

const ControlBar: React.FC<ControlBarProps> = ({ onMicClick, onTypeClick, onToolsClick, isMicActive, disabled }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-900 to-transparent pb-8">
      <div className="flex items-center justify-around max-w-sm mx-auto">
        {/* Tools */}
        <button 
            onClick={onToolsClick} 
            disabled={disabled}
            className="p-4 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors backdrop-blur-sm"
        >
            {/* Plus Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        </button>

        {/* Type */}
        <button 
            onClick={onTypeClick} 
            disabled={disabled}
            className="p-4 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors backdrop-blur-sm"
        >
            {/* Bubble Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
        </button>

        {/* Mic (Primary) */}
        <button 
            onClick={onMicClick} 
            className={`
                p-6 rounded-full transition-all shadow-lg transform active:scale-95
                ${isMicActive 
                    ? 'bg-red-500 text-white shadow-red-500/50 animate-pulse' 
                    : 'bg-purple-600 text-white shadow-purple-600/50 hover:bg-purple-500'
                }
            `}
        >
            {/* Mic Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
        </button>
      </div>
    </div>
  );
};

export default ControlBar;