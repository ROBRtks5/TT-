
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import * as hapticService from '../../services/hapticService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (apiKey: string, geminiKey?: string) => Promise<void>;
}

// SECURITY FIX: HARDCODED KEYS AS REQUESTED (CRUEL SAVE)
const HARDCODED_T_KEY = "t.UCevZu4UiEEQIBppwMTVlaKrqEpZk5VgYWA-MyL1xTntiSBderg3bsxypO_ns76flXxA9wxRP_6TjGJkKXWLRw";
const HARDCODED_GEMINI_KEY = "AIzaSyBYbfedL2v7zAAMZ9Hr36fTFOq6wmwU2ZI";

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isValidTKey, setIsValidTKey] = useState(true);

  // AUTO-INJECT ON MOUNT
  useEffect(() => {
     const savedKey = localStorage.getItem('tbank-api-key') || HARDCODED_T_KEY;
     setApiKey(savedKey);

     const savedGeminiKey = localStorage.getItem('gemini-api-key') || HARDCODED_GEMINI_KEY;
     setGeminiApiKey(savedGeminiKey);
     
     // Force save to storage if hardcoded exists but storage is empty
     if (!localStorage.getItem('tbank-api-key') && HARDCODED_T_KEY) {
         localStorage.setItem('tbank-api-key', HARDCODED_T_KEY);
     }
     if (!localStorage.getItem('gemini-api-key') && HARDCODED_GEMINI_KEY) {
         localStorage.setItem('gemini-api-key', HARDCODED_GEMINI_KEY);
     }
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setApiKey(val);
      setIsValidTKey(val.startsWith('t.') || val.length === 0);
  };

  if (!isOpen) {
    return null;
  }

  const handleSave = async () => {
    setIsSaving(true);
    hapticService.success();
    if (geminiApiKey) localStorage.setItem('gemini-api-key', geminiApiKey);
    
    await onSave(apiKey, geminiApiKey || undefined);
    setIsSaving(false);
    onClose();
  };

  const InputField = ({ label, value, onChange, type = "text", placeholder, error = false, icon = "🔑" }: any) => (
      <div className="group relative">
          <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 transition-colors ${error ? 'text-cyber-pink' : 'text-gray-500 group-focus-within:text-cyber-cyan'}`}>
              {label}
          </label>
          <div className="relative">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-white transition-colors pl-2">
                  {icon}
              </div>
              <input
                  type={type}
                  value={value}
                  onChange={onChange}
                  placeholder={placeholder}
                  className={`w-full bg-black border-b-2 pl-8 pr-2 py-2 text-sm font-mono text-white placeholder-gray-800 outline-none transition-all ${error ? 'border-cyber-pink' : 'border-gray-800 focus:border-cyber-cyan'}`}
              />
          </div>
          {error && <p className="text-[9px] text-cyber-pink mt-1 animate-pulse">⚠️ INVALID FORMAT</p>}
      </div>
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-fade-in">
      <div className="w-full max-w-md relative overflow-hidden border border-cyber-cyan/30 bg-black shadow-[0_0_50px_rgba(0,240,255,0.1)] clip-corner-br">
        
        {/* Header Decoration */}
        <div className="absolute top-0 left-0 w-full h-1 bg-cyber-cyan/50 shadow-[0_0_10px_#00f0ff]"></div>
        
        <div className="p-6">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-xl font-black text-white tracking-widest uppercase flex items-center gap-2">
                        <span className="text-cyber-cyan">🔐</span> ACCESS_CONTROL
                    </h2>
                    <p className="text-[10px] text-gray-500 font-mono mt-1">SECURITY CLEARANCE LEVEL 1</p>
                </div>
                <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-pulse"></div>
            </div>
            
            <div className="space-y-6">
                {/* T-BANK */}
                <InputField 
                    label="T-INVEST TOKEN (RW)" 
                    value={apiKey} 
                    onChange={handleApiKeyChange} 
                    type="password" 
                    placeholder="t.xxxxxxxx..."
                    error={!isValidTKey}
                    icon="🏦"
                />

                {/* GOOGLE GEMINI */}
                <InputField 
                    label="NEURAL LINK (GEMINI)" 
                    value={geminiApiKey} 
                    onChange={(e: any) => setGeminiApiKey(e.target.value)} 
                    type="password" 
                    placeholder="AIzaSy..."
                    icon="🧠"
                />
            </div>

            <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-gray-900">
                <Button 
                    variant="secondary" 
                    onClick={onClose} 
                    disabled={isSaving}
                    className="text-[10px] py-3 px-6 border-red-900/50 text-red-500 hover:bg-red-900/10 hover:border-red-500"
                >
                    ОТМЕНА
                </Button>
                <Button 
                    variant="primary" 
                    onClick={handleSave} 
                    disabled={!apiKey || isSaving || !isValidTKey}
                    className="text-[10px] py-3 px-8 shadow-[0_0_15px_rgba(252,238,10,0.3)]"
                >
                    {isSaving ? 'ШИФРОВАНИЕ...' : 'ПОДТВЕРДИТЬ ДОСТУП'}
                </Button>
            </div>
        </div>
        
        {/* Corner Decors */}
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyber-cyan opacity-50"></div>
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyber-cyan opacity-50"></div>
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyber-cyan opacity-50"></div>

      </div>
    </div>,
    document.body
  );
};

export default ApiKeyModal;
