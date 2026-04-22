
import React from 'react';
import * as hapticService from '../../services/hapticService';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'danger' | 'secondary';
  className?: string;
  disableHaptic?: boolean; // New prop to optionally disable haptics
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', className = '', disableHaptic = false, onClick, ...props }) => {
  // Base: Angular cut bottom-right, font-mono, tracking-wide
  // Added: active:translate-y-[1px] for tactile feel
  const baseClasses = 'relative px-6 py-2 font-bold uppercase tracking-widest transition-all duration-75 focus:outline-none clip-corner-br active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale font-mono select-none active:shadow-inner';

  const variantClasses = {
    // Primary: Cyber Yellow (CP77 Style)
    primary: 'bg-cyber-yellow text-black hover:bg-[#fff700] hover:shadow-[0_0_15px_rgba(252,238,10,0.4)] border-none',
    
    // Success: Cyber Green
    success: 'bg-cyber-green text-black hover:bg-[#33ffbb] hover:shadow-[0_0_15px_rgba(0,255,159,0.4)] border-none',
    
    // Danger: Arasaka Red
    danger: 'bg-cyber-pink text-black hover:bg-[#ff3366] hover:shadow-[0_0_15px_rgba(255,0,60,0.4)] border-none',
    
    // Secondary: Hollow tech look
    secondary: 'bg-transparent border border-cyber-cyan/50 text-cyber-cyan hover:bg-cyber-cyan/10 hover:border-cyber-cyan hover:shadow-[0_0_10px_rgba(0,240,255,0.2)]',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!disableHaptic && !props.disabled) {
          hapticService.tap();
      }
      if (onClick) onClick(e);
  };

  return (
    <button className={`${baseClasses} ${variantClasses[variant]} ${className} group`} onClick={handleClick} {...props}>
      {/* Glitch Overlay Effect on Hover */}
      <span className="absolute inset-0 bg-white/10 hidden group-hover:block mix-blend-overlay clip-corner-br pointer-events-none"></span>
      {children}
    </button>
  );
};

export default Button;
