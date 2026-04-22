
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  variant?: 'default' | 'danger' | 'success';
  noPadding?: boolean;
}

const Card: React.FC<CardProps> = ({ children, className = '', title, variant = 'default', noPadding = false }) => {
  // Color mapping based on variant
  const borderColor = variant === 'danger' ? 'border-cyber-pink' : variant === 'success' ? 'border-cyber-green' : 'border-cyber-cyan/30';
  const titleColor = variant === 'danger' ? 'text-cyber-pink' : variant === 'success' ? 'text-cyber-green' : 'text-cyber-cyan';

  // Layout Logic:
  // Outer div is now flex-col to support fixed heights with headers.
  // Inner div is flex-1 to fill remaining space.
  
  const innerClasses = noPadding 
    ? 'relative z-0 flex-1 min-h-0' 
    : 'p-4 sm:p-5 relative z-0 flex-1 min-h-0';

  return (
    <div className={`relative bg-cyber-black border ${borderColor} ${className} group flex flex-col`}>
      {/* DECORATIVE CORNERS (Tech Lines) */}
      <div className={`absolute -top-[1px] -left-[1px] w-2 h-2 border-t-2 border-l-2 ${borderColor} z-10 opacity-70`}></div>
      <div className={`absolute -top-[1px] -right-[1px] w-2 h-2 border-t-2 border-r-2 ${borderColor} z-10 opacity-70`}></div>
      <div className={`absolute -bottom-[1px] -left-[1px] w-2 h-2 border-b-2 border-l-2 ${borderColor} z-10 opacity-70`}></div>
      <div className={`absolute -bottom-[1px] -right-[1px] w-2 h-2 border-b-2 border-r-2 ${borderColor} z-10 opacity-70`}></div>

      {/* HEADER WITH DECO LINE */}
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-cyber-dark/50 border-b border-gray-800 shrink-0">
            <h2 className={`text-lg font-bold tracking-widest uppercase font-sans ${titleColor} drop-shadow-[0_0_5px_rgba(0,0,0,0.8)]`}>
                {title}
            </h2>
            {/* Tech Dots */}
            <div className="flex gap-1">
                <div className={`w-1 h-1 rounded-full ${titleColor} opacity-50`}></div>
                <div className={`w-1 h-1 rounded-full ${titleColor} opacity-30`}></div>
                <div className={`w-1 h-1 rounded-full ${titleColor} opacity-10`}></div>
            </div>
        </div>
      )}
      
      <div className={innerClasses}>
          {/* Subtle Grid Background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,18,18,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,18,0.1)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none -z-10"></div>
          {children}
      </div>
    </div>
  );
};

export default Card;
