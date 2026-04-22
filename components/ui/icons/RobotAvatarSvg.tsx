
import React from 'react';

interface RobotAvatarSvgProps {
  expression: 'neutral' | 'happy' | 'sad';
  className?: string;
}

const RobotAvatarSvg: React.FC<RobotAvatarSvgProps> = ({ expression, className = "mx-auto" }) => {
  const bodyColor = "#4B5563"; 
  const bodyHighlight = "#9CA3AF"; 
  const eyeColor = "#5EEAD4"; 
  const shadowColor = "#374151";

  const armTransform = {
    neutral: "rotate(5 7 32)",
    happy: "rotate(-45 7 32)",
    sad: "rotate(20 7 32)",
  };

  const rightArmTransform = {
      neutral: "rotate(-5 43 32)",
      happy: "rotate(45 43 32)",
      sad: "rotate(-20 43 32)",
  };

  const expressions = {
    neutral: <rect x="20" y="20" width="10" height="1.5" fill={eyeColor} rx="1" />,
    happy: <path d="M 20 19 Q 25 24, 30 19" stroke={eyeColor} strokeWidth="1.5" fill="none" />,
    sad: <path d="M 20 22 Q 25 17, 30 22" stroke={eyeColor} strokeWidth="1.5" fill="none" />,
  };

  return (
    <svg viewBox="0 0 50 50" width="80" height="80" className={className}>
      {/* Legs */}
      <rect x="15" y="40" width="8" height="10" fill={shadowColor} rx="2" />
      <rect x="27" y="40" width="8" height="10" fill={shadowColor} rx="2" />
      {/* Body */}
      <rect x="10" y="22" width="30" height="20" fill={bodyColor} rx="3" />
      <rect x="18" y="28" height="8" width="14" fill={bodyHighlight} opacity="0.5" rx="2" />
      {/* Arms */}
      <g transform={armTransform[expression]} className="transition-transform duration-300 ease-in-out">
        <rect x="3" y="25" width="8" height="15" fill={bodyColor} rx="4" />
      </g>
      <g transform={rightArmTransform[expression]} className="transition-transform duration-300 ease-in-out">
        <rect x="39" y="25" width="8" height="15" fill={bodyColor} rx="4" />
      </g>
      {/* Neck */}
      <rect x="22" y="20" width="6" height="4" fill={shadowColor} />
      {/* Head */}
      <rect x="12" y="8" width="26" height="16" fill={bodyColor} rx="3" />
      {/* Face */}
      <circle cx="19" cy="16" r="2" fill={eyeColor} />
      <circle cx="31" cy="16" r="2" fill={eyeColor} />
      <g className="transition-opacity duration-300">
        {expressions[expression]}
      </g>
      {/* Antenna */}
      <line x1="25" y1="8" x2="25" y2="4" stroke={bodyHighlight} strokeWidth="2" />
      <circle cx="25" cy="3" r="2" fill={eyeColor} />
    </svg>
  );
};

export default React.memo(RobotAvatarSvg);
