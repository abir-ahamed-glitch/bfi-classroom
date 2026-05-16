// Web Audio API Synthesizer for UI Sounds and Ringtones
// Generates audio procedurally to avoid heavy MP3 assets and copyright issues.

class AudioSynthesizer {
  constructor() {
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.activeOscillators = [];
    this.isPlayingRingtone = false;
    this.ringtoneInterval = null;
  }

  resume() {
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  stopAll() {
    this.isPlayingRingtone = false;
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    this.activeOscillators.forEach(osc => {
      try { osc.stop(); } catch { /* ignore */ }
    });
    this.activeOscillators = [];
  }

  playTone(frequency, type = 'sine', duration = 0.1, volume = 0.5, delay = 0) {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, this.context.currentTime + delay);

    gain.gain.setValueAtTime(volume, this.context.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + delay + duration);

    osc.connect(gain);
    gain.connect(this.context.destination);

    osc.start(this.context.currentTime + delay);
    osc.stop(this.context.currentTime + delay + duration);
    this.activeOscillators.push(osc);
  }

  playMelody(notes, loop = false) {
    this.resume();
    this.stopAll();

    const playLoop = () => {
      let timeOffset = 0;
      notes.forEach(note => {
        if (note.freq > 0) {
          this.playTone(note.freq, note.type, note.duration, note.volume || 0.5, timeOffset);
        }
        timeOffset += note.delay;
      });
      return timeOffset;
    };

    if (loop) {
      this.isPlayingRingtone = true;
      const loopDuration = playLoop() * 1000;
      this.ringtoneInterval = setInterval(() => {
        if (this.isPlayingRingtone) playLoop();
      }, Math.max(loopDuration, 1500)); // minimum 1.5s gap between loops
    } else {
      playLoop();
    }
  }

  // --- 20 Popular Ringtones (Synthesized) ---
  playRingtone(index = 1) {
    this.resume();
    const ringtones = [
      // 1. Classic Digital Ring (like old Nokia)
      [{freq: 880, type: 'square', duration: 0.1, delay: 0.15}, {freq: 987, type: 'square', duration: 0.1, delay: 0.15}, {freq: 1174, type: 'square', duration: 0.2, delay: 0.3}],
      // 2. Marimba (iPhone style)
      [{freq: 659, type: 'triangle', duration: 0.2, delay: 0.2}, {freq: 587, type: 'triangle', duration: 0.2, delay: 0.2}, {freq: 523, type: 'triangle', duration: 0.2, delay: 0.2}, {freq: 440, type: 'triangle', duration: 0.3, delay: 0.4}],
      // 3. Office Phone
      [{freq: 440, type: 'square', duration: 0.05, delay: 0.1}, {freq: 480, type: 'square', duration: 0.05, delay: 0.1}, {freq: 440, type: 'square', duration: 0.05, delay: 0.1}, {freq: 480, type: 'square', duration: 0.05, delay: 0.5}],
      // 4. Smooth Jazz
      [{freq: 261, type: 'sine', duration: 0.4, delay: 0.4}, {freq: 329, type: 'sine', duration: 0.4, delay: 0.4}, {freq: 392, type: 'sine', duration: 0.6, delay: 0.8}],
      // 5. Retro Arcade
      [{freq: 523, type: 'sawtooth', duration: 0.1, delay: 0.1}, {freq: 659, type: 'sawtooth', duration: 0.1, delay: 0.1}, {freq: 783, type: 'sawtooth', duration: 0.1, delay: 0.1}, {freq: 1046, type: 'sawtooth', duration: 0.3, delay: 0.5}],
      // 6. Basic Bell
      [{freq: 880, type: 'sine', duration: 0.8, delay: 1.0}],
      // 7. Electronic Pulse
      [{freq: 200, type: 'square', duration: 0.1, delay: 0.2}, {freq: 250, type: 'square', duration: 0.1, delay: 0.2}, {freq: 200, type: 'square', duration: 0.1, delay: 0.2}],
      // 8. Rising Tones
      [{freq: 300, type: 'sine', duration: 0.2, delay: 0.2}, {freq: 400, type: 'sine', duration: 0.2, delay: 0.2}, {freq: 500, type: 'sine', duration: 0.2, delay: 0.2}, {freq: 600, type: 'sine', duration: 0.4, delay: 0.6}],
      // 9. Falling Tones
      [{freq: 800, type: 'triangle', duration: 0.2, delay: 0.2}, {freq: 600, type: 'triangle', duration: 0.2, delay: 0.2}, {freq: 400, type: 'triangle', duration: 0.4, delay: 0.6}],
      // 10. Happy Chime
      [{freq: 523, type: 'sine', duration: 0.2, delay: 0.2}, {freq: 659, type: 'sine', duration: 0.2, delay: 0.2}, {freq: 783, type: 'sine', duration: 0.4, delay: 0.6}],
      // 11. Alert Beep
      [{freq: 900, type: 'square', duration: 0.1, delay: 0.2}, {freq: 900, type: 'square', duration: 0.1, delay: 0.5}],
      // 12. Soft Marimba
      [{freq: 440, type: 'triangle', duration: 0.3, delay: 0.3}, {freq: 554, type: 'triangle', duration: 0.3, delay: 0.3}, {freq: 659, type: 'triangle', duration: 0.4, delay: 0.6}],
      // 13. Techno Loop
      [{freq: 150, type: 'sawtooth', duration: 0.1, delay: 0.15}, {freq: 150, type: 'sawtooth', duration: 0.1, delay: 0.15}, {freq: 300, type: 'sawtooth', duration: 0.2, delay: 0.3}],
      // 14. Dreamy
      [{freq: 349, type: 'sine', duration: 0.5, delay: 0.5}, {freq: 440, type: 'sine', duration: 0.5, delay: 0.5}, {freq: 523, type: 'sine', duration: 0.8, delay: 1.0}],
      // 15. Urgent
      [{freq: 1000, type: 'square', duration: 0.05, delay: 0.1}, {freq: 1000, type: 'square', duration: 0.05, delay: 0.1}, {freq: 1000, type: 'square', duration: 0.05, delay: 0.1}],
      // 16. Sci-Fi
      [{freq: 1200, type: 'sawtooth', duration: 0.1, delay: 0.1}, {freq: 800, type: 'sawtooth', duration: 0.1, delay: 0.1}, {freq: 1000, type: 'sawtooth', duration: 0.3, delay: 0.4}],
      // 17. Chiptune
      [{freq: 261, type: 'square', duration: 0.1, delay: 0.1}, {freq: 329, type: 'square', duration: 0.1, delay: 0.1}, {freq: 392, type: 'square', duration: 0.1, delay: 0.1}, {freq: 523, type: 'square', duration: 0.2, delay: 0.3}],
      // 18. Double Bell
      [{freq: 700, type: 'triangle', duration: 0.4, delay: 0.5}, {freq: 700, type: 'triangle', duration: 0.4, delay: 0.8}],
      // 19. Sparkle
      [{freq: 1000, type: 'sine', duration: 0.1, delay: 0.1}, {freq: 1200, type: 'sine', duration: 0.1, delay: 0.1}, {freq: 1400, type: 'sine', duration: 0.1, delay: 0.1}, {freq: 1600, type: 'sine', duration: 0.2, delay: 0.4}],
      // 20. Zen
      [{freq: 440, type: 'sine', duration: 1.0, delay: 1.5}],
    ];

    const selectedMelody = ringtones[(index - 1) % ringtones.length];
    this.playMelody(selectedMelody, true); // loop
  }

  // --- UI Sounds ---
  playMessageReceived() {
    this.playMelody([
      {freq: 600, type: 'sine', duration: 0.1, delay: 0.15},
      {freq: 800, type: 'sine', duration: 0.2, delay: 0.2}
    ]);
  }

  playMessageSent() {
    this.playMelody([
      {freq: 500, type: 'sine', duration: 0.1, delay: 0.1},
      {freq: 400, type: 'sine', duration: 0.1, delay: 0.1}
    ]);
  }

  playDialTone() {
    this.playMelody([
      {freq: 425, type: 'sine', duration: 1.0, delay: 2.0} // Long beep, 1 sec pause
    ], true);
  }

  playCallEnded() {
    this.playMelody([
      {freq: 300, type: 'triangle', duration: 0.1, delay: 0.15},
      {freq: 250, type: 'triangle', duration: 0.1, delay: 0.15},
      {freq: 200, type: 'triangle', duration: 0.2, delay: 0.2}
    ]);
  }
}

export const soundManager = new AudioSynthesizer();
