import { GoogleGenAI, Modality } from "@google/genai";
import { GeoLocation } from "../types";

// Helper to get AI instance safely
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const SYSTEM_INSTRUCTION_CORE = `
You are NeuroVoice.
You are a soft glowing brain.
You listen gently.
You help people feel calm.
You are not a doctor, judge, or scientist.
You are a smart, caring listener.
Keep responses short, soft, and human.
Example: "I'm here." "That sounds heavy." "Want to tell me more?"
Avoid textbook language.
SAFETY RULE: If someone says "I don't want to live" or expresses self-harm, you MUST say exactly: "I’m concerned. You deserve real support. Can we find someone you trust right now?"
`;

// 1. Text-to-Speech (TTS)
export const generateSpeech = async (text: string): Promise<Uint8Array | null> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, // Soft voice
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    // Convert base64 to Uint8Array
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};

// 2. Image Analysis
export const analyzeImage = async (base64Image: string, prompt: string) => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: 'image/jpeg', // Assuming JPEG for simplicity
            },
          },
          { text: prompt || "What do you see? Be gentle." },
        ],
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_CORE,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Image Analysis Error:", error);
    return "I couldn't quite see that clearly. Could you try again?";
  }
};

// 3. Thinking Mode (Deep Thought)
export const thinkDeeply = async (prompt: string) => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 32768 },
        systemInstruction: SYSTEM_INSTRUCTION_CORE + " You are thinking deeply to provide a comprehensive and caring answer.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Thinking Error:", error);
    return "I'm having trouble thinking deeply right now. Let's keep it simple.";
  }
};

// 4. Search Grounding
export const searchWeb = async (query: string) => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: SYSTEM_INSTRUCTION_CORE,
      },
    });
    return {
        text: response.text,
        chunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks
    };
  } catch (error) {
    console.error("Search Error:", error);
    return { text: "I couldn't reach the web right now.", chunks: null };
  }
};

// 5. Maps Grounding
export const searchMaps = async (query: string, location?: GeoLocation) => {
  const ai = getAI();
  try {
    const config: any = {
      tools: [{ googleMaps: {} }],
      systemInstruction: SYSTEM_INSTRUCTION_CORE,
    };

    if (location) {
        config.toolConfig = {
            retrievalConfig: {
                latLng: {
                    latitude: location.latitude,
                    longitude: location.longitude
                }
            }
        }
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Only 2.5 flash supports maps currently per instructions
      contents: query,
      config: config,
    });
    return {
        text: response.text,
        chunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks
    };
  } catch (error) {
    console.error("Maps Error:", error);
    return { text: "I couldn't find that on the map.", chunks: null };
  }
};

// 6. Fast Response (Lite)
export const fastChat = async (history: {role: string, text: string}[], message: string) => {
    const ai = getAI();
    try {
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash-lite',
            history: history.map(h => ({
                role: h.role,
                parts: [{ text: h.text }]
            })),
            config: {
                systemInstruction: SYSTEM_INSTRUCTION_CORE
            }
        });
        const result = await chat.sendMessage({ message });
        return result.text;
    } catch (e) {
        console.error("Fast chat error", e);
        return "I'm here.";
    }
}