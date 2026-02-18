import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToBytes, createPcmBlob, decodeAudioData } from './services/audioUtils';
import * as GeminiService from './services/geminiService';
import Orb from './components/Orb';
import EmotionSelector from './components/EmotionSelector';
import ControlBar from './components/ControlBar';
import { Emotion, GeoLocation } from './types';

// Constants
const API_KEY = process.env.API_KEY || '';
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

// Define the Mode state
type Mode = 'idle' | 'live' | 'chat' | 'tools';

function App() {
  const [mode, setMode] = useState<Mode>('idle');
  const [emotion, setEmotion] = useState<Emotion | undefined>(undefined);
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>("Tap microphone to start");
  
  // Chat / Tools State
  const [textInput, setTextInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: 'user'|'model', text: string}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toolResult, setToolResult] = useState<{text?: string, image?: string, chunks?: any} | null>(null);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null); // To store the live session
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Visualizer Analyser Ref (managed by state to trigger re-renders in Orb if changed, though usually persistent)
  const [visualizerAnalyser, setVisualizerAnalyser] = useState<AnalyserNode | null>(null);

  // --- Live API Setup ---
  
  const startLiveSession = async () => {
    if (!API_KEY) {
      alert("API Key is missing!");
      return;
    }

    try {
      setMode('live');
      setStatusMessage("Connecting...");
      setOrbState('listening');

      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      // Ensure we don't leak contexts
      if (inputContextRef.current) await inputContextRef.current.close();
      if (audioContextRef.current) await audioContextRef.current.close();

      inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      
      // Critical: Resume contexts on user gesture
      await inputContextRef.current.resume();
      await audioContextRef.current.resume();

      // Get User Media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      // Define System Instruction based on current emotion if selected
      const emotionalContext = emotion ? `The user feels ${emotion}. Be supportive.` : '';
      const instruction = `${GeminiService.SYSTEM_INSTRUCTION_CORE} ${emotionalContext}`;

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, // Zephyr is calm
          },
          systemInstruction: instruction,
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            setStatusMessage("I'm listening.");
            setOrbState('listening');
            
            // Start streaming audio input & Set up Visualizer for Mic
            if (!inputContextRef.current) return;
            const source = inputContextRef.current.createMediaStreamSource(stream);
            
            // Analyser for Visualization
            const analyser = inputContextRef.current.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            setVisualizerAnalyser(analyser);

            const scriptProcessor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
              }).catch(err => {
                  console.error("Error sending input:", err);
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                setOrbState('speaking');
                
                const ctx = audioContextRef.current;
                
                // If we are speaking, switch visualizer to output context
                // Create a persistent analyser for output if not exists or if context changed
                // Note: creating new analyser per chunk is bad, but here we likely need one attached to destination?
                // Actually, let's attach one analyser to the context destination for output visualization.
                // However, we are playing buffers individually.
                
                // Better strategy: Attach analyser to destination of outputContext ONCE.
                // But we are inside onmessage.
                
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                try {
                    const audioBuffer = await decodeAudioData(
                        base64ToBytes(base64Audio),
                        ctx,
                        24000,
                        1
                    );
                    
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    
                    // Visualizer for Output
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 512;
                    source.connect(analyser);
                    analyser.connect(ctx.destination);
                    
                    // Update state to use this analyser
                    setVisualizerAnalyser(analyser);
                    
                    source.addEventListener('ended', () => {
                        sourceNodesRef.current.delete(source);
                        if (sourceNodesRef.current.size === 0) {
                            setOrbState('listening');
                            // Switch back to Mic Visualizer
                            if (inputContextRef.current && mediaStreamRef.current) {
                                // Re-create/get mic analyser? 
                                // Simplified: when speaking ends, we just assume listening, 
                                // but we need to reset the visualizer source to the mic.
                                // In this simple app structure, we might need a stored reference to mic analyser.
                            }
                        }
                    });

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourceNodesRef.current.add(source);
                } catch (e) {
                    console.error("Audio Decode Error in Live:", e);
                }
            }

            // Handle Turn Complete (User finished speaking, model finished processing)
            if (msg.serverContent?.turnComplete) {
                // Could reset specific states if needed
            }
            
            // Handle Interruption
             if (msg.serverContent?.interrupted) {
                sourceNodesRef.current.forEach(node => node.stop());
                sourceNodesRef.current.clear();
                nextStartTimeRef.current = 0;
                setOrbState('listening');
                
                // Reset visualizer to mic if we were interrupted
                // (Ideally we have a cleaner way to switch back, for now user might need to speak to re-trigger)
             }
          },
          onclose: () => {
            console.log("Live Session Closed");
            stopLiveSession();
          },
          onerror: (err) => {
            console.error("Live Session Error", err);
            setStatusMessage("Connection error.");
            stopLiveSession();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Failed to start live session:", error);
      setStatusMessage("Could not access microphone.");
      setMode('idle');
    }
  };

  const stopLiveSession = async () => {
    // Cleanup Audio
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if (inputContextRef.current) {
        await inputContextRef.current.close();
        inputContextRef.current = null;
    }
    
    // Close Session if possible
    if (sessionRef.current) {
        try {
            const session = await sessionRef.current;
            if (typeof session.close === 'function') {
                session.close();
            }
        } catch (e) {
            console.warn("Error closing session", e);
        }
        sessionRef.current = null;
    }

    setVisualizerAnalyser(null);
    setMode('idle');
    setOrbState('idle');
    setStatusMessage("Tap microphone to start");
  };

  // --- Tool / Chat Logic ---

  const handleSendMessage = async () => {
    if (!textInput.trim()) return;
    
    const userMsg = textInput;
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setTextInput("");
    setIsProcessing(true);
    setOrbState('thinking');

    // Simple routing logic based on keywords
    const lower = userMsg.toLowerCase();
    let responseText = "";
    let chunks = null;

    if (lower.includes("map") || lower.includes("find") || lower.includes("location") || lower.includes("where")) {
        // Maps Grounding
        let loc: GeoLocation | undefined = undefined;
        try {
             // Quick geo check
             const pos: any = await new Promise((resolve, reject) => {
                 navigator.geolocation.getCurrentPosition(resolve, reject);
             });
             loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch (e) {
            console.warn("Geo access denied", e);
        }
        const result = await GeminiService.searchMaps(userMsg, loc);
        responseText = result.text || "I found this.";
        chunks = result.chunks;

    } else if (lower.includes("search") || lower.includes("google") || lower.includes("news")) {
        // Search Grounding
        const result = await GeminiService.searchWeb(userMsg);
        responseText = result.text || "Here is what I found.";
        chunks = result.chunks;

    } else if (lower.includes("think") || lower.includes("deep") || lower.includes("analyze")) {
        // Thinking Model
        responseText = await GeminiService.thinkDeeply(userMsg) || "I've thought about it.";

    } else {
        // Fast Chat
        responseText = await GeminiService.fastChat(chatHistory, userMsg) || "I hear you.";
    }

    setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    setToolResult({ text: responseText, chunks });
    setIsProcessing(false);
    setOrbState('idle');

    // Attempt to read it out (TTS) to maintain "Voice" feel
    const audioBytes = await GeminiService.generateSpeech(responseText);
    if (audioBytes) {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass({ sampleRate: 24000 });
            await ctx.resume();
            
            const buffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            
            // TTS Visualizer
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            setVisualizerAnalyser(analyser);

            source.start();
            setOrbState('speaking');
            source.onended = () => {
                setOrbState('idle');
                setVisualizerAnalyser(null);
            };
        } catch (e) {
            console.error("TTS Playback Error:", e);
        }
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setIsProcessing(true);
          setOrbState('thinking');
          
          setToolResult({ image: reader.result as string, text: "Analyzing..." });
          
          const text = await GeminiService.analyzeImage(base64, "Describe this image kindly.");
          setToolResult({ image: reader.result as string, text });
          setIsProcessing(false);
          setOrbState('idle');

          // TTS
          const audioBytes = await GeminiService.generateSpeech(text || "");
          if (audioBytes) {
            try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                await ctx.resume();
                
                const buffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                source.connect(analyser);
                analyser.connect(ctx.destination);
                setVisualizerAnalyser(analyser);

                source.connect(ctx.destination);
                source.start();
                setOrbState('speaking');
                source.onended = () => {
                    setOrbState('idle');
                    setVisualizerAnalyser(null);
                };
            } catch (e) {
                console.error("TTS Playback Error:", e);
            }
          }
      };
      reader.readAsDataURL(file);
  };

  // --- Handlers ---
  
  const toggleMic = () => {
    if (mode === 'live') {
        stopLiveSession();
    } else {
        startLiveSession();
    }
  };

  const openTools = () => {
    stopLiveSession(); // Ensure live is off
    setMode('tools');
    // Trigger hidden file input
    document.getElementById('image-upload')?.click();
  };

  const openChat = () => {
      stopLiveSession();
      setMode('chat');
  };

  // Render Helpers
  const renderGrounding = () => {
      if (!toolResult?.chunks) return null;
      
      // Basic rendering for grounding chunks (maps or search)
      return (
          <div className="mt-4 p-4 bg-slate-800 rounded-lg text-sm max-h-40 overflow-y-auto">
              <h4 className="font-bold text-slate-400 mb-2">Sources</h4>
              {toolResult.chunks.map((chunk: any, i: number) => {
                  if (chunk.web) {
                      return (
                          <div key={i} className="mb-2">
                              <a href={chunk.web.uri} target="_blank" rel="noreferrer" className="text-purple-400 hover:underline block truncate">
                                  {chunk.web.title || chunk.web.uri}
                              </a>
                          </div>
                      );
                  }
                  if (chunk.maps) {
                       return (
                          <div key={i} className="mb-2">
                              <a href={chunk.maps.googleMapsUri} target="_blank" rel="noreferrer" className="text-purple-400 hover:underline block truncate">
                                  {chunk.maps.title}
                              </a>
                              <div className="text-xs text-slate-500">{chunk.maps.formattedAddress}</div>
                          </div>
                      );
                  }
                  return null;
              })}
          </div>
      )
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center relative selection:bg-purple-500/30">
        
      {/* Header / Status */}
      <div className="absolute top-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
         <div className="pointer-events-auto">
            <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400">
                NeuroVoice
            </h1>
            <p className="text-slate-500 text-sm mt-1 animate-pulse">
                {statusMessage}
            </p>
         </div>
      </div>

      {/* Main Visual Area */}
      <div className="flex-1 w-full flex flex-col items-center justify-center relative">
        <Orb state={orbState} analyser={visualizerAnalyser} emotion={emotion} />
        
        {/* Emotion Buttons - Only show if idle or listening */}
        {(mode === 'idle' || mode === 'live') && (
            <div className="mt-8 z-10">
                <EmotionSelector 
                    selected={emotion} 
                    onSelect={(e) => {
                        setEmotion(e);
                        // If live, we might ideally re-send system instruction, 
                        // but for now we just set state for next connection or context.
                        // Advanced: Send a text message to the live session "I am feeling X"
                        if (sessionRef.current && mode === 'live') {
                             sessionRef.current.then((s: any) => s.sendRealtimeInput({
                                 text: `I am feeling ${e} now.` 
                             }));
                        }
                    }} 
                />
            </div>
        )}

        {/* Text/Tool Overlay */}
        {(mode === 'chat' || mode === 'tools') && (
            <div className="absolute inset-x-0 bottom-32 max-w-lg mx-auto p-4 animate-fade-in-up">
                 {/* Display Tool Result */}
                 {toolResult && (
                     <div className="mb-4 bg-slate-800/90 backdrop-blur rounded-xl p-4 border border-slate-700">
                         {toolResult.image && <img src={toolResult.image} alt="Analyzed" className="w-full h-48 object-cover rounded-lg mb-4" />}
                         <p className="text-slate-200 text-lg leading-relaxed">{toolResult.text}</p>
                         {renderGrounding()}
                     </div>
                 )}

                 {/* Input Area */}
                 <div className="flex items-center gap-2 bg-slate-800 p-2 rounded-full border border-slate-700 shadow-xl">
                     <input 
                        type="text" 
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder={mode === 'chat' ? "Type your thoughts..." : "Ask..."}
                        className="flex-1 bg-transparent border-none text-white px-4 focus:ring-0 focus:outline-none placeholder-slate-500"
                        disabled={isProcessing}
                        autoFocus
                     />
                     <button 
                        onClick={handleSendMessage}
                        disabled={isProcessing || !textInput.trim()}
                        className="p-3 bg-purple-600 rounded-full text-white disabled:opacity-50"
                     >
                        {isProcessing ? (
                             <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        )}
                     </button>
                 </div>
            </div>
        )}
      </div>

      {/* Hidden Inputs */}
      <input 
        id="image-upload" 
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleImageUpload}
      />

      {/* Navigation */}
      <ControlBar 
        onMicClick={toggleMic}
        onTypeClick={openChat}
        onToolsClick={openTools}
        isMicActive={mode === 'live'}
        disabled={isProcessing && mode !== 'live'}
      />
      
    </div>
  );
}

export default App;