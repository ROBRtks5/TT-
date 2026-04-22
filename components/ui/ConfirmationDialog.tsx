
import React from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import * as hapticService from '../../services/hapticService';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ isOpen, onClose, onConfirm, title, children }) => {
  if (!isOpen) {
    return null;
  }

  const handleConfirm = () => {
      hapticService.warning(); // Heavy feedback for dangerous action
      onConfirm();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100000] p-6 animate-fade-in">
      <div className="w-full max-w-sm bg-black border-2 border-red-600/50 relative overflow-hidden shadow-[0_0_50px_rgba(220,38,38,0.3)] transform transition-all scale-100 clip-corner-br">
        
        {/* HAZARD STRIPES */}
        <div className="absolute top-0 left-0 w-full h-1 bg-[repeating-linear-gradient(45deg,#b91c1c,#b91c1c_10px,#000_10px,#000_20px)]"></div>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-[repeating-linear-gradient(45deg,#b91c1c,#b91c1c_10px,#000_10px,#000_20px)]"></div>

        <div className="p-6">
            <div className="flex items-center gap-3 mb-4 text-red-500">
                <span className="text-3xl animate-pulse">⚠️</span>
                <h2 className="text-xl font-black uppercase tracking-widest leading-none">{title}</h2>
            </div>
            
            <div className="text-sm font-mono text-gray-300 mb-8 border-l-2 border-red-900/50 pl-4 py-2">
                {children}
            </div>
            
            <div className="flex flex-col gap-3">
                <Button 
                    variant="danger" 
                    onClick={handleConfirm}
                    className="w-full py-4 text-sm font-black tracking-[0.2em] shadow-lg shadow-red-900/20"
                >
                    ПОДТВЕРДИТЬ
                </Button>
                <Button 
                    variant="secondary" 
                    onClick={() => { hapticService.tap(); onClose(); }}
                    className="w-full py-3 text-xs opacity-80 hover:opacity-100 border-gray-700 text-gray-400"
                >
                    ОТМЕНА
                </Button>
            </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmationDialog;
