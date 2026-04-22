
/**
 * TITAN TRADING BOT - SONIC ENGINE (WEB AUDIO API)
 * ---------------------------------------------------------
 * @module services/audioService.ts
 * @version 1.0.0
 * @phase Protocol Sonic
 * @description
 * Генеративный аудио-движок. Создает звуковые эффекты (SFX) 
 * с помощью осцилляторов в реальном времени. Без внешних файлов.
 * ---------------------------------------------------------
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = true; // Default to muted for browser policy compliance

const initAudio = () => {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContext();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.3; // Default volume 30%
            masterGain.connect(audioCtx.destination);
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
};

export const toggleMute = (muted: boolean) => {
    isMuted = muted;
    if (!isMuted) {
        initAudio();
    }
};

// --- SYNTHESIZERS ---

/**
 * Plays a high-tech "Ping" sound (Notification/Success)
 */
export const playSuccess = () => {
    if (isMuted || !audioCtx || !masterGain) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    // Frequency sweep: 880Hz -> 1760Hz (High pitch)
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
};

/**
 * Plays a harsh "Glitch/Buzz" sound (Error/Warning)
 */
export const playError = () => {
    if (isMuted || !audioCtx || !masterGain) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, audioCtx.currentTime); // Low frequency
    osc.frequency.linearRampToValueAtTime(55, audioCtx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
};

/**
 * Plays a "Power Up" sound (Startup)
 */
export const playStartup = () => {
    if (isMuted || !audioCtx || !masterGain) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 1.5);

    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start();
    osc.stop(audioCtx.currentTime + 1.5);
};

/**
 * Plays a generic UI "Click" sound
 */
export const playClick = () => {
    if (isMuted || !audioCtx || !masterGain) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
};
