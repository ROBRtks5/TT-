
import React, { useMemo } from 'react';

interface HoloAvatarProps {
  mood: 'IDLE' | 'WIN' | 'LOSS' | 'ACTION';
  className?: string;
}

const HoloAvatarSvg: React.FC<HoloAvatarProps> = ({ mood, className = "" }) => {
  // Dynamic colors based on mood
  const colors = useMemo(() => {
    switch (mood) {
      case 'WIN': return { primary: '#00ff9f', secondary: '#00cc80', glow: 'rgba(0, 255, 159, 0.5)' }; // Green
      case 'LOSS': return { primary: '#ff003c', secondary: '#cc0030', glow: 'rgba(255, 0, 60, 0.5)' }; // Red
      case 'ACTION': return { primary: '#fcee0a', secondary: '#cwb300', glow: 'rgba(252, 238, 10, 0.5)' }; // Yellow
      default: return { primary: '#00f0ff', secondary: '#0099cc', glow: 'rgba(0, 240, 255, 0.5)' }; // Cyan (Idle)
    }
  }, [mood]);

  return (
    <svg viewBox="0 0 200 200" className={`${className} overflow-visible`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id="scanline" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="50%" stopColor={colors.primary} stopOpacity="0.2" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <clipPath id="faceClip">
           <path d="M60,180 Q50,100 60,60 Q100,20 140,60 Q150,100 140,180 Z" />
        </clipPath>
      </defs>

      {/* --- AURA GLOW --- */}
      <circle cx="100" cy="100" r="70" fill={colors.glow} opacity="0.1" className="animate-pulse" />

      {/* --- NECK --- */}
      <rect x="85" y="160" width="30" height="40" fill="#1a1a1a" />
      <path d="M85,160 L80,200 L120,200 L115,160 Z" fill="#222" />
      {/* Cyber Neck Lines */}
      <path d="M90,170 L110,170 M90,180 L110,180" stroke={colors.primary} strokeWidth="1" opacity="0.5" />

      {/* --- HAIR (BACK) --- */}
      <g fill="#111">
         <path d="M50,60 Q20,100 40,180 L160,180 Q180,100 150,60 Z" />
      </g>

      {/* --- FACE SHAPE --- */}
      <g filter="url(#glow)">
        <path d="M60,180 Q50,100 60,60 Q100,20 140,60 Q150,100 140,180 L120,200 L80,200 Z" 
              fill="#0a0a0a" stroke={colors.primary} strokeWidth="2" />
      </g>

      {/* --- FACE DETAILS --- */}
      <g className="transition-all duration-500">
          
          {/* Eyes Container */}
          <g transform="translate(0, 10)">
              {/* Left Eye */}
              <g transform="translate(75, 90)">
                  {mood === 'LOSS' ? (
                      // Sad/Angry Eye
                      <path d="M-12,5 Q0,-5 12,5" stroke={colors.primary} strokeWidth="2" fill="none" />
                  ) : mood === 'WIN' ? (
                      // Happy Eye
                      <path d="M-12,0 Q0,-10 12,0" stroke={colors.primary} strokeWidth="2" fill="none" />
                  ) : (
                      // Normal Eye
                      <>
                        <rect x="-10" y="-3" width="20" height="6" fill={colors.primary} opacity="0.8">
                            <animate attributeName="height" values="6;0;6" dur="4s" repeatCount="indefinite" begin="1s" />
                        </rect>
                        <rect x="-12" y="-5" width="24" height="10" stroke={colors.primary} strokeWidth="1" fill="none" />
                      </>
                  )}
              </g>

              {/* Right Eye */}
              <g transform="translate(125, 90)">
                   {mood === 'LOSS' ? (
                      <path d="M-12,5 Q0,-5 12,5" stroke={colors.primary} strokeWidth="2" fill="none" />
                  ) : mood === 'WIN' ? (
                      <path d="M-12,0 Q0,-10 12,0" stroke={colors.primary} strokeWidth="2" fill="none" />
                  ) : (
                      <>
                        <rect x="-10" y="-3" width="20" height="6" fill={colors.primary} opacity="0.8">
                             <animate attributeName="height" values="6;0;6" dur="4s" repeatCount="indefinite" begin="1s" />
                        </rect>
                        <rect x="-12" y="-5" width="24" height="10" stroke={colors.primary} strokeWidth="1" fill="none" />
                      </>
                  )}
              </g>
          </g>

          {/* Mouth */}
          <g transform="translate(100, 140)">
              {mood === 'WIN' && <path d="M-10,-2 Q0,5 10,-2" stroke={colors.primary} strokeWidth="2" fill="none" />}
              {mood === 'LOSS' && <path d="M-10,2 Q0,-5 10,2" stroke={colors.primary} strokeWidth="2" fill="none" />}
              {(mood === 'IDLE' || mood === 'ACTION') && (
                  <rect x="-8" y="-1" width="16" height="2" fill={colors.primary} opacity="0.6" />
              )}
          </g>

          {/* Cyber Cheeks */}
          <rect x="65" y="110" width="10" height="2" fill={colors.primary} opacity="0.3" />
          <rect x="125" y="110" width="10" height="2" fill={colors.primary} opacity="0.3" />
      </g>

      {/* --- HAIR (FRONT) --- */}
      <g opacity="0.9">
          <path d="M100,25 Q60,25 60,100 L55,160 L75,100 Q80,50 100,50" fill={colors.secondary} opacity="0.5" />
          <path d="M100,25 Q140,25 140,100 L145,160 L125,100 Q120,50 100,50" fill={colors.secondary} opacity="0.5" />
          
          {/* Digital Bangs */}
          <path d="M100,30 L90,80 L100,70 L110,80 L100,30" fill={colors.primary} opacity="0.2" />
      </g>

      {/* --- HEADSET / HUD --- */}
      <path d="M50,80 L40,70 L40,110 L50,100" fill="#333" stroke={colors.primary} strokeWidth="1" />
      <path d="M150,80 L160,70 L160,110 L150,100" fill="#333" stroke={colors.primary} strokeWidth="1" />
      <path d="M40,70 Q100,-20 160,70" fill="none" stroke={colors.primary} strokeWidth="2" strokeDasharray="5,5" opacity="0.5" />

      {/* --- SCANLINE EFFECT OVERLAY --- */}
      <rect x="0" y="0" width="200" height="200" fill="url(#scanline)" clipPath="url(#faceClip)" opacity="0.3" style={{ mixBlendMode: 'overlay' }}>
          <animate attributeName="y" from="-200" to="200" dur="2s" repeatCount="indefinite" />
      </rect>

      {/* --- FLOATING PARTICLES --- */}
      {mood === 'ACTION' && (
          <g>
              <circle cx="50" cy="50" r="2" fill={colors.primary}><animate attributeName="cy" from="50" to="40" dur="1s" repeatCount="indefinite" /></circle>
              <circle cx="150" cy="150" r="2" fill={colors.primary}><animate attributeName="cy" from="150" to="140" dur="1.5s" repeatCount="indefinite" /></circle>
          </g>
      )}

    </svg>
  );
};

export default React.memo(HoloAvatarSvg);
