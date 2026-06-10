/* ==========================================================================
   Superheterodyne Receiver Visualizer Logic (app.js)
   Core DSP Simulation, Web Audio Synthesizer, Canvas Oscilloscopes & Export
   ========================================================================== */

// --- SIMULATION STATE VARIABLES ---
const state = {
    isRunning: true,
    rfFreq: 1000,          // in kHz (master frequency representation)
    rfAmp: 50,             // in uV
    loFreq: 1455,          // in kHz
    ifFreq: 455,           // in kHz
    noiseLevel: 5,         // in uV
    gain: 40,              // in dB
    
    // Display modes and states
    preset: 'am',          // 'am', 'fm', 'sw', 'air'
    frequencyMode: 'AM',   // 'AM' (kHz) vs 'FM' (MHz)
    unit: 'kHz',
    selectivity: 1.0,
    snr: 20.0,
    tuningAccuracy: 100.0,
    tuningMismatch: 0.0,
    
    // Audio Context
    audioVolume: 30,       // percentage
    audioMuted: false,
    
    // Faults Status
    faults: {
        rf: false,
        mixer: false,
        lo: false,
        if: false
    },
    
    // Learning Mode
    learningMode: false,
    learningStep: 0,
    activeStage: null
};

// Preset Constants (Normalized to kHz internally)
const presets = {
    am: {
        name: "AM Radio Receiver",
        unit: "kHz",
        frequencyMode: "AM",
        rfDefault: 1000,
        rfMin: 540,
        rfMax: 1600,
        rfStep: 10,
        ifFreq: 455,
        loDefault: 1455,
        loMin: 995,
        loMax: 2055,
        loStep: 10,
        spectrumMin: 0,
        spectrumMax: 2500,
        bandwidth: 10 // kHz
    },
    fm: {
        name: "FM Radio Receiver",
        unit: "MHz",
        frequencyMode: "FM",
        rfDefault: 98100, // 98.1 MHz
        rfMin: 88000,
        rfMax: 108000,
        rfStep: 100,      // 0.1 MHz steps
        ifFreq: 10700,    // 10.7 MHz
        loDefault: 108800, // 108.8 MHz (high-side)
        loMin: 98700,
        loMax: 118700,
        loStep: 100,
        spectrumMin: 50000,
        spectrumMax: 150000,
        bandwidth: 150 // kHz
    },
    sw: {
        name: "Shortwave Receiver",
        unit: "MHz",
        frequencyMode: "SW",
        rfDefault: 6000,   // 6.0 MHz
        rfMin: 3000,
        rfMax: 30000,
        rfStep: 50,        // 0.05 MHz
        ifFreq: 455,       // 455 kHz
        loDefault: 6455,   // 6.455 MHz
        loMin: 3455,
        loMax: 30455,
        loStep: 50,
        spectrumMin: 0,
        spectrumMax: 35000,
        bandwidth: 15 // kHz
    },
    air: {
        name: "Aircraft Receiver",
        unit: "MHz",
        frequencyMode: "AIR",
        rfDefault: 120000, // 120.0 MHz
        rfMin: 108000,
        rfMax: 137000,
        rfStep: 50,        // 0.05 MHz
        ifFreq: 10700,     // 10.7 MHz
        loDefault: 109300, // 109.3 MHz (low-side)
        loMin: 97300,
        loMax: 147700,
        loStep: 50,
        spectrumMin: 80000,
        spectrumMax: 160000,
        bandwidth: 50 // kHz
    }
};

// Learning Steps Configuration
const learningSteps = [
    {
        stage: 'antenna',
        title: 'Antenna Stage',
        text: 'The Antenna captures electromagnetic radio waves from space. All incoming RF signals (AM, FM, etc.) plus background electromagnetic noise are transformed into weak microvolt electrical currents.',
        formula: 'S_{ant}(t) = S_{RF}(t) + Noise(t)'
    },
    {
        stage: 'rf_amp',
        title: 'RF Amplifier Stage',
        text: 'The RF Amplifier boosts the weak microvolt signal from the antenna, improving the receiver Sensitivity. It contains a pre-selector bandpass filter that rejects image frequencies.',
        formula: 'S_{rf}(t) = G_{RF} \\cdot S_{ant}(t)'
    },
    {
        stage: 'local_osc',
        title: 'Local Oscillator (LO) Stage',
        text: 'The Local Oscillator generates a pure, stable high-frequency sine wave. As you tune the receiver RF frequency, the LO frequency sweeps in tandem to maintain a constant difference (IF).',
        formula: 'S_{lo}(t) = A_{LO} \\cdot \\cos(2\\pi f_{LO} t)'
    },
    {
        stage: 'mixer',
        title: 'Mixer (Frequency Converter)',
        text: 'The Mixer multiplies the RF signal and LO carrier. Multiplication of cosines creates sum and difference frequencies: f_{LO} \\pm f_{RF}. The difference frequency equals the Intermediate Frequency (IF).',
        formula: 'S_{mix}(t) = S_{rf}(t) \\times S_{lo}(t) = A \\cdot [\\cos(f_{LO} - f_{RF})t + \\cos(f_{LO} + f_{RF})t]'
    },
    {
        stage: 'if_amp',
        title: 'IF Amplifier & Filter',
        text: 'The IF Amplifier selectively amplifies only the difference frequency (IF) while strongly rejecting all other frequencies (using high-Q filters). This determines the receiver Selectivity.',
        formula: 'S_{if}(t) = G_{IF} \\cdot Bandpass(S_{mix}(t))'
    },
    {
        stage: 'detector',
        title: 'Demodulator / Detector',
        text: 'The Detector (diode & filter) recovers the original audio message signal. It rectifies the high-frequency IF carrier and filters out the high frequency, leaving the audio envelope.',
        formula: 'S_{audio}(t) = Lowpass(|S_{if}(t)|)'
    },
    {
        stage: 'audio_amp',
        title: 'Audio Amplifier Stage',
        text: 'The Audio Amplifier boosts the low-frequency recovered message signal (in the audible range, 20Hz - 20kHz) to a level strong enough to drive the speaker coils.',
        formula: 'S_{output}(t) = G_{audio} \\cdot S_{audio}(t)'
    },
    {
        stage: 'speaker',
        title: 'Speaker Output',
        text: 'The Speaker converts the amplified electrical audio signal into pressure waves in the air, allowing you to hear the original transmitted voice or tone.',
        formula: 'Acoustic\\;Wave = Speaker(S_{output}(t))'
    }
];

// --- DOM ELEMENTS ---
let sliders = {}, numInputs = {}, buttons = {}, texts = {};

function initDOMElements() {
    // Sliders
    sliders.rfFreq = document.getElementById('slider-rf-freq');
    sliders.loFreq = document.getElementById('slider-lo-freq');
    sliders.ifFreq = document.getElementById('slider-if-freq');
    sliders.rfAmp = document.getElementById('slider-rf-amp');
    sliders.noiseLvl = document.getElementById('slider-noise-lvl');
    sliders.gain = document.getElementById('slider-gain');
    sliders.audioVol = document.getElementById('slider-audio-vol');
    
    // Numeric Inputs
    numInputs.rfFreq = document.getElementById('num-rf-freq');
    numInputs.loFreq = document.getElementById('num-lo-freq');
    numInputs.ifFreq = document.getElementById('num-if-freq');
    numInputs.rfAmp = document.getElementById('num-rf-amp');
    numInputs.noiseLvl = document.getElementById('num-noise-lvl');
    numInputs.gain = document.getElementById('num-gain');

    // Buttons
    buttons.start = document.getElementById('btn-start');
    buttons.pause = document.getElementById('btn-pause');
    buttons.reset = document.getElementById('btn-reset');
    buttons.autotune = document.getElementById('btn-autotune');
    buttons.audioMute = document.getElementById('btn-audio-mute');
    buttons.exportImg = document.getElementById('export-img-btn');
    buttons.exportPdf = document.getElementById('export-pdf-btn');
    buttons.resetZoom = document.getElementById('btn-reset-zoom');

    // Values Display
    texts.rfFreq = document.getElementById('val-rf-freq');
    texts.loFreq = document.getElementById('val-lo-freq');
    texts.ifFreq = document.getElementById('val-if-freq');
    texts.rfAmp = document.getElementById('val-rf-amp');
    texts.noiseLvl = document.getElementById('val-noise-lvl');
    texts.gain = document.getElementById('val-gain');

    // Metrics & Details Info
    texts.mismatch = document.getElementById('metric-tuning-mismatch');
    texts.accuracy = document.getElementById('metric-tuning-accuracy');
    texts.snr = document.getElementById('metric-snr');
    texts.gainMetric = document.getElementById('metric-gain');
    texts.dbMeterValue = document.getElementById('meter-db-value');
    
    // Scope frequencies indicator
    texts.scopeRf = document.getElementById('scope-rf-freq');
    texts.scopeLo = document.getElementById('scope-lo-freq');
    texts.scopeIf = document.getElementById('scope-if-freq');
}

// --- AUDIO SYNTHESIS ENGINE (Web Audio API) ---
let audioCtx = null;
let oscillator = null;
let whiteNoiseSource = null;
let signalGain = null;
let noiseGain = null;
let masterGain = null;

function initAudio() {
    if (audioCtx) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        
        // Tone source (demodulated signal recovery)
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = 1000; // 1 kHz tone
        
        signalGain = audioCtx.createGain();
        signalGain.gain.value = 0;
        
        // White noise static source
        const bufferSize = 2 * audioCtx.sampleRate;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        whiteNoiseSource = audioCtx.createBufferSource();
        whiteNoiseSource.buffer = noiseBuffer;
        whiteNoiseSource.loop = true;
        
        noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0;
        
        masterGain = audioCtx.createGain();
        masterGain.gain.value = state.audioVolume / 100;
        
        // Routing
        oscillator.connect(signalGain);
        signalGain.connect(masterGain);
        
        whiteNoiseSource.connect(noiseGain);
        noiseGain.connect(masterGain);
        
        masterGain.connect(audioCtx.destination);
        
        // Start sources
        oscillator.start(0);
        whiteNoiseSource.start(0);
        
    } catch (e) {
        console.error("Web Audio API not supported or blocked: ", e);
    }
}

function updateAudio() {
    if (!audioCtx) return;
    
    // Resume context if suspended (browser security)
    if (state.isRunning && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Master volume
    const vol = state.audioMuted || !state.isRunning ? 0 : state.audioVolume / 100;
    masterGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);

    // If any receiver stage is broken, no signal goes through.
    const isSignalPathHealthy = !state.faults.rf && !state.faults.mixer && !state.faults.lo && !state.faults.if;
    
    let sigVol = 0;
    let nVol = 0;
    
    if (state.isRunning && isSignalPathHealthy) {
        // Signal amplitude depends on tuning accuracy, RF amplitude, and receiver gain
        const select = state.selectivity;
        const amp = state.rfAmp / 500; // normalized
        const gain = Math.pow(10, state.gain / 40); // gain scaling
        
        sigVol = select * amp * gain * 0.15;
        // Limit maximum volume to prevent audio clipping
        if (sigVol > 0.4) sigVol = 0.4;
        
        // Noise level scales with noise slider and receiver gain
        // Carrier quieting effect: higher selectivity (strong carrier tuned) reduces the static hiss!
        const baseNoise = (state.noiseLevel / 100) * (state.gain / 40) * 0.12;
        nVol = baseNoise * (1.0 - select * 0.85);
        if (nVol > 0.3) nVol = 0.3;
    } else if (state.isRunning) {
        // If there's a fault in RF, LO, or Mixer, but Audio Amp is okay, we hear full static noise!
        if (!state.faults.if) {
            nVol = (state.noiseLevel / 100) * (state.gain / 40) * 0.18;
            if (nVol > 0.45) nVol = 0.45;
        } else {
            // IF Amp failed, silence
            nVol = 0.01; 
        }
        sigVol = 0;
    } else {
        // Paused simulation
        sigVol = 0;
        nVol = 0;
    }
    
    // Smooth transitions to prevent clicks
    signalGain.gain.setTargetAtTime(sigVol, audioCtx.currentTime, 0.08);
    noiseGain.gain.setTargetAtTime(nVol, audioCtx.currentTime, 0.08);
}

// --- SIGNAL CALCULATIONS (DSP ENGINE) ---
const numScopePoints = 350;

function calculateWaveforms() {
    const rfWaves = [];
    const loWaves = [];
    const mixWaves = [];
    const ifWaves = [];
    const audioWaves = [];
    
    const p = presets[state.preset];
    
    // Normalized symbolic frequencies for smooth canvas oscilloscope plots
    // Scale real frequencies in kHz down to visible symbolic cycles (e.g. 0.02 to 0.4 rad/point)
    const rfNorm = 0.15 + ((state.rfFreq - p.rfMin) / (p.rfMax - p.rfMin)) * 0.2;
    const loNorm = 0.15 + ((state.loFreq - p.loMin) / (p.loMax - p.loMin)) * 0.2;
    
    const rfAmpNorm = state.rfAmp / 150; // Amplitude normalization for display
    const noiseNorm = state.noiseLevel / 100;
    const gainFactor = Math.pow(10, state.gain / 40) * 0.15;
    
    // Fault factor modifiers
    const rfAmpActive = state.faults.rf ? 0 : 1;
    const mixerActive = state.faults.mixer ? 0 : 1;
    const loActive = state.faults.lo ? 0 : 1;
    const ifAmpActive = state.faults.if ? 0 : 1;
    
    // Calculate Tuning Mismatch, Selectivity, and Metrics
    const actualDiff = Math.abs(state.rfFreq - state.loFreq);
    state.tuningMismatch = Math.abs(actualDiff - state.ifFreq);
    
    // Selectivity: BPF filter curve based on standard Q-factor around IF center
    const bw = p.bandwidth;
    state.selectivity = 1.0 / (1.0 + Math.pow(state.tuningMismatch / (bw * 0.6), 2));
    
    // Calculations metrics
    state.tuningAccuracy = Math.max(0, 100 - (state.tuningMismatch / (bw * 2)) * 100);
    if (state.tuningAccuracy > 100) state.tuningAccuracy = 100;
    if (state.tuningAccuracy < 0) state.tuningAccuracy = 0;
    
    // Calculate Signal to Noise Ratio (SNR)
    if (state.noiseLevel === 0) {
        state.snr = 99.9;
    } else {
        const signalPower = Math.pow(state.rfAmp * state.selectivity, 2);
        const noisePower = Math.pow(state.noiseLevel, 2);
        state.snr = Math.max(-20, (10 * Math.log10(signalPower / noisePower) + state.gain * 0.15));
    }
    
    // Signal Strength in dBm
    // RF amp boost and matching selectivity
    const pathLoss = -90; // dBm baseline
    const rfDBm = pathLoss + 20 * Math.log10(state.rfAmp) + (state.faults.rf ? -80 : 0);
    const tunedDBm = rfDBm + (10 * Math.log10(state.selectivity + 1e-6)) + state.gain;
    const finalDBm = Math.min(-10, Math.max(-110, tunedDBm));

    // Dynamic UI updates based on calculated metrics
    updateMetricsUI(finalDBm);

    // Audio envelope frequency (symbolic, slow)
    const audioPlotFreq = 0.015;
    
    // Generate sample points for oscilloscope graphs
    for (let i = 0; i < numScopePoints; i++) {
        // 1. Recovered Audio Modulation Envelope
        const m_t = 0.45 * Math.sin(i * audioPlotFreq);
        
        // Random white noise element
        const randNoise = (Math.random() - 0.5) * noiseNorm * 0.6;
        
        // RF Waveform: Modulated RF carrier
        const rfCarrier = Math.sin(i * rfNorm * 6);
        const rfVal = rfAmpActive * rfAmpNorm * (1.0 + m_t) * rfCarrier + randNoise;
        rfWaves.push(rfVal);
        
        // LO Waveform: Pure sine wave
        const loVal = loActive * 0.7 * Math.sin(i * loNorm * 6);
        loWaves.push(loVal);
        
        // Mixer Waveform: Multiplication product
        const mixVal = mixerActive * rfVal * loVal;
        mixWaves.push(mixVal);
        
        // IF Waveform: Filtered difference frequency
        // Centered around the nominal IF plot frequency, scaled by selectivity and IF stage health
        const ifPlotFreq = 0.15; // fixed IF plot representation
        let ifVal = 0;
        if (rfAmpActive && mixerActive && loActive) {
            ifVal = ifAmpActive * rfAmpNorm * state.selectivity * (1.0 + m_t) * Math.sin(i * ifPlotFreq * 6) + randNoise * 0.05;
        } else {
            ifVal = randNoise * 0.1; // only background static passes
        }
        ifWaves.push(ifVal);
        
        // Demodulated Audio Waveform
        let audVal = 0;
        if (rfAmpActive && mixerActive && loActive && ifAmpActive) {
            audVal = m_t * state.selectivity * gainFactor + randNoise * (1.0 - state.selectivity * 0.8) * gainFactor;
        } else {
            // Broken path: only static noise amplifies
            audVal = ifAmpActive ? randNoise * gainFactor * 1.5 : 0; 
        }
        audioWaves.push(audVal);
    }
    
    return { rfWaves, loWaves, mixWaves, ifWaves, audioWaves };
}

function updateMetricsUI(finalDBm) {
    if (!texts.mismatch) return;
    
    const unit = state.unit;
    const isAM = (state.frequencyMode === 'AM');
    
    // Tuning mismatch text
    let mismatchText = "";
    if (isAM) {
        mismatchText = `${state.tuningMismatch.toFixed(1)} kHz`;
    } else {
        mismatchText = `${(state.tuningMismatch / 1000).toFixed(3)} MHz`;
    }
    texts.mismatch.textContent = mismatchText;
    
    // Tuning accuracy text
    texts.accuracy.textContent = `${state.tuningAccuracy.toFixed(1)}%`;
    if (state.tuningAccuracy > 85) {
        texts.accuracy.className = "metric-value text-success";
    } else if (state.tuningAccuracy > 40) {
        texts.accuracy.className = "metric-value text-warning";
    } else {
        texts.accuracy.className = "metric-value text-danger";
    }
    
    // SNR
    texts.snr.textContent = `${state.snr.toFixed(1)} dB`;
    if (state.snr > 15) {
        texts.snr.className = "metric-value text-info";
    } else if (state.snr > 5) {
        texts.snr.className = "metric-value text-warning";
    } else {
        texts.snr.className = "metric-value text-danger";
    }
    
    // Gain
    texts.gainMetric.textContent = `${state.gain.toFixed(1)} dB`;
    
    // dBm Analog Meter updates
    texts.dbMeterValue.textContent = `${Math.round(finalDBm)} dBm`;
    
    const meterBar = document.getElementById('signal-meter-bar');
    if (meterBar) {
        // Map dBm [-110, -10] to percentage [0, 100]
        const percent = ((finalDBm + 110) / 100) * 100;
        meterBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
}

// --- OSCILLOSCOPE CANVAS RENDERER ---
const canvasIds = ['canvas-rf', 'canvas-lo', 'canvas-mix', 'canvas-if', 'canvas-audio'];

function drawOscilloscopes(waveforms) {
    const colors = {
        rf: 'rgba(59, 130, 246, 0.95)',    // Blue
        lo: 'rgba(245, 158, 11, 0.95)',    // Yellow
        mix: 'rgba(6, 182, 212, 0.95)',   // Cyan
        if: 'rgba(16, 185, 129, 0.95)',   // Green
        audio: 'rgba(168, 85, 247, 0.95)' // Purple
    };

    drawSingleScope('canvas-rf', waveforms.rfWaves, colors.rf);
    drawSingleScope('canvas-lo', waveforms.loWaves, colors.lo);
    drawSingleScope('canvas-mix', waveforms.mixWaves, colors.mix);
    drawSingleScope('canvas-if', waveforms.ifWaves, colors.if);
    drawSingleScope('canvas-audio', waveforms.audioWaves, colors.audio);
}

function drawSingleScope(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Check if backing store matches client width/height (responsive sizing)
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    
    ctx.clearRect(0, 0, width, height);
    
    // Draw oscilloscope central division grid line (dotted)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]); // reset
    
    // Draw waveform data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = color;
    ctx.beginPath();
    
    const sliceWidth = width / data.length;
    let x = 0;
    
    for (let i = 0; i < data.length; i++) {
        // scale wave peak value (around -1 to 1) to fit scope scale height
        const y = (height / 2) - (data[i] * (height / 2.3));
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
}

// --- FFT SPECTRUM ANALYZER CHART (Chart.js) ---
let spectrumChart = null;

function initSpectrumChart() {
    const ctx = document.getElementById('chart-spectrum').getContext('2d');
    if (!ctx) return;
    
    const p = presets[state.preset];
    
    spectrumChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Signal Power (dBm)',
                data: generateSpectrumData(),
                borderColor: 'rgba(6, 182, 212, 0.85)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                backgroundColor: 'rgba(6, 182, 212, 0.04)',
                tension: 0.15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Performance speedup
            scales: {
                x: {
                    type: 'linear',
                    min: p.spectrumMin,
                    max: p.spectrumMax,
                    title: {
                        display: true,
                        text: `Frequency (${state.unit})`,
                        color: 'var(--text-muted)',
                        font: { family: 'Orbitron', size: 10 }
                    },
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: 'var(--text-muted)', font: { family: 'Orbitron', size: 9 } }
                },
                y: {
                    min: -110,
                    max: 10,
                    title: {
                        display: true,
                        text: 'Power Level (dBm)',
                        color: 'var(--text-muted)',
                        font: { family: 'Orbitron', size: 10 }
                    },
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: 'var(--text-muted)', font: { family: 'Orbitron', size: 9 } }
                }
            },
            plugins: {
                legend: { display: false },
                zoom: {
                    pan: { enabled: true, mode: 'x' },
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: 'x'
                    }
                }
            }
        },
        plugins: [peakMarkerPlugin]
    });
}

// Custom plugin to draw vertical line indicators and text labels at frequencies
const peakMarkerPlugin = {
    id: 'peakMarkerPlugin',
    afterDraw: (chart) => {
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;
        
        const isAM = (state.frequencyMode === 'AM');
        const unit = state.unit;
        
        const formatF = (val) => {
            if (isAM) return `${Math.round(val)} kHz`;
            return `${(val / 1000).toFixed(2)} MHz`;
        };

        const imageFreq = state.loFreq + (state.loFreq - state.rfFreq); // High-side image

        const peaks = [
            { freq: state.rfFreq, label: 'RF Peak', color: '#3b82f6', show: !state.faults.rf },
            { freq: state.loFreq, label: 'LO Peak', color: '#f59e0b', show: !state.loFreq ? false : !state.faults.lo },
            { freq: state.ifFreq, label: 'IF Band', color: '#10b981', show: !state.faults.if && state.selectivity > 0.08 },
            { freq: imageFreq, label: 'Image Freq', color: '#f87171', show: !state.faults.rf && !state.faults.lo }
        ];

        peaks.forEach(peak => {
            if (!peak.show) return;
            const xPixel = xAxis.getPixelForValue(peak.freq);
            
            // Check if pixel location is within visible chart boundaries
            if (xPixel >= xAxis.left && xPixel <= xAxis.right) {
                ctx.save();
                // Draw vertical line
                ctx.strokeStyle = peak.color;
                ctx.lineWidth = 1.2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(xPixel, yAxis.top);
                ctx.lineTo(xPixel, yAxis.bottom);
                ctx.stroke();
                
                // Draw text labels
                ctx.fillStyle = peak.color;
                ctx.font = 'bold 9px Orbitron';
                ctx.textAlign = 'center';
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = 2;
                ctx.fillText(peak.label, xPixel, yAxis.top + 16);
                ctx.fillText(formatF(peak.freq), xPixel, yAxis.top + 28);
                ctx.restore();
            }
        });
    }
};

function generateSpectrumData() {
    const dataPoints = [];
    const p = presets[state.preset];
    
    const steps = 300;
    const startFreq = p.spectrumMin;
    const endFreq = p.spectrumMax;
    const stepSize = (endFreq - startFreq) / steps;
    
    const rfActive = state.faults.rf ? 0 : 1;
    const mixerActive = state.faults.mixer ? 0 : 1;
    const loActive = state.faults.lo ? 0 : 1;
    const ifActive = state.faults.if ? 0 : 1;

    const noiseFloor = -90 - (state.noiseLevel / 2);
    
    // Positive height scaling values above the noise floor
    // RF peak height ranges from 15 dB (min RF amp, min Gain) to 65 dB (max RF amp, max Gain)
    const rfHeight = rfActive * Math.max(5, 15 + (state.rfAmp / 500) * 35 + (state.gain / 80) * 15);
    
    // LO peak is a steady injection carrier, height above noise floor is constant
    const loHeight = loActive * 75; // e.g. -15 dBm peak height
    
    // IF peak is centered at state.ifFreq, height depends on selectivity (tuning error)
    let ifHeight = 0;
    if (rfActive && mixerActive && loActive && ifActive) {
        ifHeight = state.selectivity * Math.max(10, 20 + (state.rfAmp / 500) * 30 + (state.gain / 80) * 25);
    }
    
    // Image Frequency: LO + (LO - RF)
    const imageFreq = state.loFreq + (state.loFreq - state.rfFreq);
    // Image frequency is attenuated by the RF front-end pre-selection filter (e.g. 20-40dB down)
    const imageRejection = 30; // dB attenuation
    const imageHeight = rfActive * loActive * Math.max(0, (rfHeight - imageRejection));

    for (let i = 0; i <= steps; i++) {
        const freq = startFreq + i * stepSize;
        
        // Random thermal noise floor
        let power = noiseFloor + (Math.random() - 0.5) * 2;
        
        // 1. Add RF Signal Peak (Gaussian shape)
        const rfPeak = rfHeight * Math.exp(-Math.pow((freq - state.rfFreq) / (p.bandwidth * 3.5), 2));
        power = Math.max(power, noiseFloor + rfPeak);
        
        // 2. Add LO Signal Peak (Gaussian shape, narrow)
        const loPeak = loHeight * Math.exp(-Math.pow((freq - state.loFreq) / (p.bandwidth * 1.5), 2));
        power = Math.max(power, noiseFloor + loPeak);
        
        // 3. Add IF Signal Peak (Gaussian shape)
        const ifPeak = ifHeight * Math.exp(-Math.pow((freq - state.ifFreq) / (p.bandwidth * 2.0), 2));
        power = Math.max(power, noiseFloor + ifPeak);
        
        // 4. Add Image Frequency Peak
        const imagePeak = imageHeight * Math.exp(-Math.pow((freq - imageFreq) / (p.bandwidth * 4.0), 2));
        power = Math.max(power, noiseFloor + imagePeak);
        
        dataPoints.push({ x: freq, y: power });
    }
    
    return dataPoints;
}

function updateSpectrumChart() {
    if (!spectrumChart) return;
    spectrumChart.data.datasets[0].data = generateSpectrumData();
    spectrumChart.update();
}

// --- SIGNAL FLOW ANIMATIONS ENGINE ---
function updateSignalFlowVisuals() {
    const isRunning = state.isRunning;
    
    // Check stage failure status
    const rfFail = state.faults.rf;
    const mixFail = state.faults.mixer;
    const loFail = state.faults.lo;
    const ifFail = state.faults.if;
    
    // Manage Block UI outlines
    document.getElementById('block-rf-amp').classList.toggle('faulty-stage', rfFail);
    document.getElementById('block-mixer').classList.toggle('faulty-stage', mixFail);
    document.getElementById('block-lo').classList.toggle('faulty-stage', loFail);
    document.getElementById('block-if-amp').classList.toggle('faulty-stage', ifFail);
    
    // Set arrow connections opacity based on simulation status & healthy paths
    toggleFlowLine('flow-ant-rf', isRunning && !rfFail);
    toggleFlowLine('flow-rf-mix', isRunning && !rfFail);
    toggleFlowLine('flow-lo-mix', isRunning && !loFail);
    toggleFlowLine('flow-mix-if', isRunning && !rfFail && !mixFail && !loFail);
    toggleFlowLine('flow-if-det', isRunning && !rfFail && !mixFail && !loFail && !ifFail);
    toggleFlowLine('flow-det-aud', isRunning && !rfFail && !mixFail && !loFail && !ifFail);
    toggleFlowLine('flow-aud-spk', isRunning && !rfFail && !mixFail && !loFail && !ifFail);

    // Audio sound waves animation on speaker
    const isTuned = state.selectivity > 0.15;
    const speakerSounding = isRunning && isTuned && !rfFail && !mixFail && !loFail && !ifFail;
    
    document.getElementById('spk-wave-1').style.opacity = speakerSounding ? 1.0 : 0.0;
    document.getElementById('spk-wave-2').style.opacity = speakerSounding ? 1.0 : 0.0;
}

function toggleFlowLine(lineId, active) {
    const el = document.getElementById(lineId);
    if (!el) return;
    if (active) {
        el.style.opacity = "0.95";
    } else {
        el.style.opacity = "0";
    }
}

// --- TUNING KNOB ROTATION ENGINE (DRAG & DROP) ---
let isDraggingKnob = false;
let knobStartAngle = 0;
let baseFreqOnDragStart = 1000;
let rotationAngle = 0;

function initTuningKnob() {
    const knob = document.getElementById('virtual-tuning-knob');
    if (!knob) return;
    
    // Pointer Drag Start
    knob.addEventListener('mousedown', (e) => {
        startKnobDrag(e.clientX, e.clientY);
        e.preventDefault();
    });
    knob.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            startKnobDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
        e.preventDefault();
    });

    // Pointer Drag Move
    window.addEventListener('mousemove', (e) => {
        if (isDraggingKnob) moveKnobDrag(e.clientX, e.clientY);
    });
    window.addEventListener('touchmove', (e) => {
        if (isDraggingKnob && e.touches.length === 1) {
            moveKnobDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    });

    // Pointer Drag End
    window.addEventListener('mouseup', () => { isDraggingKnob = false; });
    window.addEventListener('touchend', () => { isDraggingKnob = false; });
}

function startKnobDrag(clientX, clientY) {
    isDraggingKnob = true;
    initAudio(); // Activate audio if not already done
    
    const knob = document.getElementById('virtual-tuning-knob');
    const rect = knob.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    knobStartAngle = Math.atan2(clientY - centerY, clientX - centerX);
    baseFreqOnDragStart = state.rfFreq;
}

function moveKnobDrag(clientX, clientY) {
    const knob = document.getElementById('virtual-tuning-knob');
    const rect = knob.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const currentAngle = Math.atan2(clientY - centerY, clientX - centerX);
    let angleDiff = currentAngle - knobStartAngle;
    
    // Convert to degrees
    let degDiff = angleDiff * (180 / Math.PI);
    
    // Fine-tune RF frequency based on rotation angle (e.g. 1 kHz per degree for AM, 50 kHz for FM)
    const p = presets[state.preset];
    let sensitivityScale = 1.0;
    if (state.preset === 'fm') sensitivityScale = 50.0;
    else if (state.preset === 'sw') sensitivityScale = 10.0;
    else if (state.preset === 'air') sensitivityScale = 50.0;
    
    let newFreq = baseFreqOnDragStart + degDiff * sensitivityScale;
    
    // Bound frequency values
    if (newFreq < p.rfMin) newFreq = p.rfMin;
    if (newFreq > p.rfMax) newFreq = p.rfMax;
    
    // Snap to steps if AM/FM
    newFreq = Math.round(newFreq / p.rfStep) * p.rfStep;
    
    // Update Frequency values
    state.rfFreq = newFreq;
    
    // Rotate the visual UI dial
    rotationAngle += degDiff * 0.15;
    knob.style.transform = `rotate(${rotationAngle}deg)`;
    
    // Update UI components
    updateFrequencyUI();
    updateAudio();
}

function updateFrequencyUI() {
    const isAM = (state.frequencyMode === 'AM');
    const displayVal = isAM ? state.rfFreq : (state.rfFreq / 1000).toFixed(2);
    
    sliders.rfFreq.value = state.rfFreq;
    numInputs.rfFreq.value = displayVal;
    texts.rfFreq.textContent = displayVal;
    
    // Mirror frequencies on oscilloscope tags
    texts.scopeRf.textContent = isAM ? `${Math.round(state.rfFreq)} kHz` : `${(state.rfFreq/1000).toFixed(2)} MHz`;
    texts.scopeLo.textContent = isAM ? `${Math.round(state.loFreq)} kHz` : `${(state.loFreq/1000).toFixed(2)} MHz`;
    texts.scopeIf.textContent = isAM ? `${Math.round(state.ifFreq)} kHz` : `${(state.ifFreq/1000).toFixed(2)} MHz`;

    updateDynamicMath();
}

// --- DYNAMIC KATEX MATH GENERATOR ---
function updateDynamicMath() {
    const mathContainer = document.getElementById('live-calculation-values');
    if (!mathContainer) return;
    
    let rfStr, loStr, ifStr;
    const isAM = (state.frequencyMode === 'AM');
    
    if (isAM) {
        rfStr = `${Math.round(state.rfFreq)}\\text{ kHz}`;
        loStr = `${Math.round(state.loFreq)}\\text{ kHz}`;
        ifStr = `${Math.round(Math.abs(state.rfFreq - state.loFreq))}\\text{ kHz}`;
    } else {
        rfStr = `${(state.rfFreq / 1000).toFixed(2)}\\text{ MHz}`;
        loStr = `${(state.loFreq / 1000).toFixed(2)}\\text{ MHz}`;
        ifStr = `${(Math.abs(state.rfFreq - state.loFreq) / 1000).toFixed(2)}\\text{ MHz}`;
    }
    
    const textFormula = `${ifStr} = |${rfStr} - ${loStr}|`;
    
    try {
        katex.render(textFormula, mathContainer, {
            displayMode: true,
            throwOnError: false
        });
    } catch (e) {
        mathContainer.innerHTML = textFormula;
    }
    
    // Injection type indicator
    const badge = document.getElementById('injection-type-badge');
    if (badge) {
        if (state.loFreq > state.rfFreq) {
            badge.textContent = "High-Side Injection (LO > RF)";
            badge.style.background = "rgba(245, 158, 11, 0.1)";
            badge.style.borderColor = "rgba(245, 158, 11, 0.25)";
            badge.style.color = "#f59e0b";
        } else {
            badge.textContent = "Low-Side Injection (LO < RF)";
            badge.style.background = "rgba(59, 130, 246, 0.1)";
            badge.style.borderColor = "rgba(59, 130, 246, 0.25)";
            badge.style.color = "#60a5fa";
        }
    }
}

// --- PRESET SWITCHER ENGINE ---
function loadPreset(presetName) {
    if (!presets[presetName]) return;
    state.preset = presetName;
    
    const p = presets[presetName];
    state.frequencyMode = p.frequencyMode;
    state.unit = p.unit;
    
    // Update Mode Label Badge
    const badge = document.getElementById('frequency-mode-badge');
    if (badge) {
        badge.textContent = `${p.name}: ${p.unit} Operation`;
    }
    
    // Set Slider Limits
    sliders.rfFreq.min = p.rfMin;
    sliders.rfFreq.max = p.rfMax;
    sliders.rfFreq.step = p.rfStep;
    sliders.rfFreq.value = p.rfDefault;
    
    sliders.loFreq.min = p.loMin;
    sliders.loFreq.max = p.loMax;
    sliders.loFreq.step = p.loStep;
    sliders.loFreq.value = p.loDefault;
    
    // IF Lock status update
    sliders.ifFreq.value = p.ifFreq;
    numInputs.ifFreq.value = p.unit === 'kHz' ? p.ifFreq : p.ifFreq / 1000;
    
    // Set state values
    state.rfFreq = p.rfDefault;
    state.loFreq = p.loDefault;
    state.ifFreq = p.ifFreq;
    
    // Update Frequency Mode Units beside sliders
    document.querySelectorAll('.freq-unit').forEach(el => {
        el.textContent = p.unit;
    });
    
    // Update FFT Spectrum scales
    if (spectrumChart) {
        spectrumChart.options.scales.x.min = p.spectrumMin;
        spectrumChart.options.scales.x.max = p.spectrumMax;
        spectrumChart.options.scales.x.title.text = `Frequency (${p.unit})`;
        spectrumChart.update();
    }
    
    // Update numeric boxes limits
    numInputs.rfFreq.min = p.unit === 'kHz' ? p.rfMin : p.rfMin / 1000;
    numInputs.rfFreq.max = p.unit === 'kHz' ? p.rfMax : p.rfMax / 1000;
    numInputs.rfFreq.step = p.unit === 'kHz' ? p.rfStep : p.rfStep / 1000;
    
    numInputs.loFreq.min = p.unit === 'kHz' ? p.loMin : p.loMin / 1000;
    numInputs.loFreq.max = p.unit === 'kHz' ? p.loMax : p.loMax / 1000;
    numInputs.loFreq.step = p.unit === 'kHz' ? p.loStep : p.loStep / 1000;

    // Reset Zoom on spectrum chart
    if (spectrumChart) {
        spectrumChart.resetZoom();
    }
    
    updateFrequencyUI();
    updateAudio();
}

// --- AUTO TUNE ALGORITHM ---
let autoTuneInterval = null;

function runAutoTune() {
    clearInterval(autoTuneInterval);
    initAudio();
    
    const p = presets[state.preset];
    
    // target LO = RF + IF (High-side) or LO = RF - IF (Low-side)
    // We aim to align to standard high-side injection by default,
    // unless high-side is out of bounds, in which case low-side.
    let targetLO = state.rfFreq + state.ifFreq;
    if (targetLO > p.loMax || targetLO < p.loMin) {
        targetLO = state.rfFreq - state.ifFreq;
    }
    
    const startLO = state.loFreq;
    const diff = targetLO - startLO;
    const duration = 1200; // ms
    const steps = 30;
    const stepTime = duration / steps;
    let currentStep = 0;
    
    buttons.autotune.disabled = true;
    
    autoTuneInterval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        
        // Linear interpolation
        state.loFreq = Math.round(startLO + diff * progress);
        
        // Bound LO
        if (state.loFreq < p.loMin) state.loFreq = p.loMin;
        if (state.loFreq > p.loMax) state.loFreq = p.loMax;
        
        // Format & sync inputs
        const isAM = (state.frequencyMode === 'AM');
        const displayLO = isAM ? state.loFreq : (state.loFreq / 1000).toFixed(2);
        
        sliders.loFreq.value = state.loFreq;
        numInputs.loFreq.value = displayLO;
        texts.loFreq.textContent = displayLO;
        texts.scopeLo.textContent = isAM ? `${Math.round(state.loFreq)} kHz` : `${(state.loFreq/1000).toFixed(2)} MHz`;
        
        updateDynamicMath();
        updateAudio();
        
        if (currentStep >= steps) {
            clearInterval(autoTuneInterval);
            buttons.autotune.disabled = false;
        }
    }, stepTime);
}

// --- STAGE DETAIL PANEL RENDERING ---
function showStageDetails(stageName) {
    state.activeStage = stageName;
    
    // Highlight block in SVG
    document.querySelectorAll('.block-group').forEach(b => {
        b.classList.remove('active-stage');
    });
    
    const targetBlock = document.getElementById(`block-${stageName.replace('_', '-')}`);
    if (targetBlock) {
        targetBlock.classList.add('active-stage');
    }
    
    // Find stage data
    const stageData = learningSteps.find(s => s.stage === stageName);
    if (!stageData) return;
    
    const titleEl = document.getElementById('stage-info-title');
    const descEl = document.getElementById('stage-info-desc');
    const mathBox = document.getElementById('stage-info-math-box');
    const mathFormula = document.getElementById('stage-info-formula');
    const freqBox = document.getElementById('stage-info-frequencies');
    const fInEl = document.getElementById('stage-info-fin');
    const fOutEl = document.getElementById('stage-info-fout');
    const badgeEl = document.getElementById('stage-info-badge');
    
    // Populate text content
    const stageIndex = learningSteps.findIndex(s => s.stage === stageName);
    badgeEl.textContent = `STAGE ${stageIndex + 1}`;
    titleEl.textContent = `Stage Details: ${stageData.title}`;
    descEl.textContent = stageData.text;
    
    // Show formula using KaTeX
    mathBox.classList.remove('hidden');
    try {
        katex.render(stageData.formula, mathFormula, { throwOnError: false });
    } catch(e) {
        mathFormula.textContent = stageData.formula;
    }
    
    // Show inputs/outputs frequency details
    freqBox.classList.remove('hidden');
    const isAM = (state.frequencyMode === 'AM');
    const fRF = isAM ? `${Math.round(state.rfFreq)} kHz` : `${(state.rfFreq/1000).toFixed(2)} MHz`;
    const fLO = isAM ? `${Math.round(state.loFreq)} kHz` : `${(state.loFreq/1000).toFixed(2)} MHz`;
    const fIF = isAM ? `${Math.round(state.ifFreq)} kHz` : `${(state.ifFreq/1000).toFixed(2)} MHz`;
    
    if (stageName === 'antenna') {
        fInEl.textContent = "EM Waves (Spatial)";
        fOutEl.textContent = fRF;
    } else if (stageName === 'rf_amp') {
        fInEl.textContent = fRF;
        fOutEl.textContent = fRF;
    } else if (stageName === 'local_osc') {
        fInEl.textContent = "DC Voltage Bias";
        fOutEl.textContent = fLO;
    } else if (stageName === 'mixer') {
        fInEl.textContent = `${fRF} (RF) & ${fLO} (LO)`;
        fOutEl.textContent = `${fRF} ± ${fLO}`;
    } else if (stageName === 'if_amp') {
        fInEl.textContent = `${fRF} ± ${fLO}`;
        fOutEl.textContent = fIF;
    } else if (stageName === 'detector') {
        fInEl.textContent = fIF;
        fOutEl.textContent = "Audio Signal (0-20 kHz)";
    } else if (stageName === 'audio_amp') {
        fInEl.textContent = "Audio Signal (0-20 kHz)";
        fOutEl.textContent = "Audio Power Signal";
    } else if (stageName === 'speaker') {
        fInEl.textContent = "Audio Power Signal";
        fOutEl.textContent = "Acoustic sound waves";
    }
}

// --- LEARNING MODE WIZARD ---
function initLearningMode() {
    const toggle = document.getElementById('learning-mode-toggle');
    const wizardBox = document.getElementById('learning-wizard-box');
    
    toggle.addEventListener('change', (e) => {
        state.learningMode = e.target.checked;
        wizardBox.classList.toggle('hidden', !state.learningMode);
        
        if (state.learningMode) {
            state.learningStep = 0;
            updateWizardStep();
        } else {
            // Remove SVG highlights
            document.querySelectorAll('.block-group').forEach(b => {
                b.classList.remove('active-stage');
            });
            state.activeStage = null;
        }
    });
    
    document.getElementById('btn-close-wizard').addEventListener('click', () => {
        toggle.checked = false;
        state.learningMode = false;
        wizardBox.classList.add('hidden');
        document.querySelectorAll('.block-group').forEach(b => {
            b.classList.remove('active-stage');
        });
        state.activeStage = null;
    });
    
    document.getElementById('btn-wizard-next').addEventListener('click', () => {
        if (state.learningStep < learningSteps.length - 1) {
            state.learningStep++;
            updateWizardStep();
        }
    });
    
    document.getElementById('btn-wizard-prev').addEventListener('click', () => {
        if (state.learningStep > 0) {
            state.learningStep--;
            updateWizardStep();
        }
    });
}

function updateWizardStep() {
    const stepData = learningSteps[state.learningStep];
    if (!stepData) return;
    
    // Update texts inside Wizard modal
    document.getElementById('wizard-stage-name').textContent = `${state.learningStep + 1}. ${stepData.title}`;
    document.getElementById('wizard-stage-text').textContent = stepData.text;
    document.getElementById('wizard-progress-txt').textContent = `${state.learningStep + 1} / ${learningSteps.length}`;
    
    // Disable/enable action buttons
    document.getElementById('btn-wizard-prev').disabled = (state.learningStep === 0);
    const nextBtn = document.getElementById('btn-wizard-next');
    if (state.learningStep === learningSteps.length - 1) {
        nextBtn.textContent = "Finish";
    } else {
        nextBtn.textContent = "Next Stage";
    }
    
    // If click Finish, close modal
    if (state.learningStep === learningSteps.length - 1) {
        nextBtn.onclick = () => {
            document.getElementById('learning-mode-toggle').checked = false;
            state.learningMode = false;
            document.getElementById('learning-wizard-box').classList.add('hidden');
            document.querySelectorAll('.block-group').forEach(b => {
                b.classList.remove('active-stage');
            });
            state.activeStage = null;
            // Restore standard listener
            nextBtn.onclick = null;
        };
    } else {
        nextBtn.onclick = null; // resets inline function override
    }
    
    // Focus detail view on this stage
    showStageDetails(stepData.stage);
}

// --- FAULT CONSOLE ENGINE ---
function initFaultConsole() {
    const triggers = document.querySelectorAll('.fault-trigger');
    const banner = document.getElementById('fault-alert-banner');
    const msgEl = document.getElementById('fault-alert-msg');
    
    triggers.forEach(trigger => {
        trigger.addEventListener('change', (e) => {
            const faultType = e.target.id.replace('fault-', ''); // 'rf', 'mixer', 'lo', 'if'
            state.faults[faultType] = e.target.checked;
            
            // Check if any fault is active
            const activeFaults = Object.keys(state.faults).filter(k => state.faults[k]);
            
            if (activeFaults.length > 0) {
                banner.classList.remove('hidden');
                
                // Construct explanatory warning text
                let warningText = "Fault Alert: ";
                if (state.faults.rf) {
                    warningText += "RF Amplifier Failure. Weak input signals are blocked. SNR degraded.";
                } else if (state.faults.mixer) {
                    warningText += "Mixer Failure. Signal heterodyning fails. Output carrier lost.";
                } else if (state.faults.lo) {
                    warningText += "Local Oscillator Failure. No carrier mixing possible. Static noise output.";
                } else if (state.faults.if) {
                    warningText += "IF Amplifier Failure. Intermediate frequency path broken. No audio recovered.";
                }
                msgEl.textContent = warningText;
            } else {
                banner.classList.add('hidden');
            }
            
            // Force redraw and audio volume update
            updateAudio();
            updateSignalFlowVisuals();
            updateSpectrumChart();
        });
    });
}

// --- SCREENSHOT EXPORT ---
function exportDashboardScreenshot() {
    const container = document.querySelector('.lab-grid');
    if (!container) return;
    
    // Capture and save image
    html2canvas(container, {
        backgroundColor: '#080c16',
        scale: 1.5,
        useCORS: true
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Superheterodyne_Receiver_Dashboard_${state.preset.toUpperCase()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

// --- PDF LAB REPORT GENERATOR ---
function exportPDFReport() {
    const container = document.querySelector('.lab-grid');
    if (!container) return;
    
    // Disable buttons during capture
    buttons.exportPdf.disabled = true;
    buttons.exportPdf.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    html2canvas(container, {
        backgroundColor: '#080c16',
        scale: 1.2,
        useCORS: true
    }).then(canvas => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');
        
        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        
        // Report Header Banner
        doc.setFillColor(8, 12, 22);
        doc.rect(0, 0, pageWidth, 40, 'F');
        
        doc.setFont("Orbitron", "bold");
        doc.setFontSize(16);
        doc.setTextColor(0, 242, 254);
        doc.text("SUPERHETERODYNE RECEIVER LAB REPORT", 14, 18);
        
        doc.setFont("Inter", "normal");
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.text("Virtual Laboratory Experimentation Report", 14, 25);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
        
        // Parameters Section
        doc.setFontSize(12);
        doc.setFont("Inter", "bold");
        doc.setTextColor(15, 23, 42); // dark slate text
        doc.text("1. Experiment Parameters", 14, 52);
        
        doc.setFont("Inter", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        
        const isAM = (state.frequencyMode === 'AM');
        const unit = state.unit;
        const rfVal = isAM ? `${state.rfFreq} kHz` : `${(state.rfFreq/1000).toFixed(2)} MHz`;
        const loVal = isAM ? `${state.loFreq} kHz` : `${(state.loFreq/1000).toFixed(2)} MHz`;
        const ifVal = isAM ? `${state.ifFreq} kHz` : `${(state.ifFreq/1000).toFixed(2)} MHz`;
        
        // Parameters Table Layout
        let yPos = 60;
        doc.text(`Receiver Preset Mode: ${presets[state.preset].name}`, 14, yPos);
        doc.text(`RF Frequency: ${rfVal}`, 14, yPos + 6);
        doc.text(`LO Frequency: ${loVal}`, 14, yPos + 12);
        doc.text(`IF Frequency: ${ifVal}`, 14, yPos + 18);
        
        doc.text(`Tuning Accuracy: ${state.tuningAccuracy.toFixed(1)}%`, 110, yPos);
        doc.text(`Signal SNR: ${state.snr.toFixed(1)} dB`, 110, yPos + 6);
        doc.text(`Tuning Mismatch: ${state.tuningMismatch.toFixed(2)} ${unit}`, 110, yPos + 12);
        doc.text(`Receiver Gain: ${state.gain} dB`, 110, yPos + 18);
        
        // System Health
        doc.setFont("Inter", "bold");
        doc.text("System Fault Status:", 14, yPos + 27);
        doc.setFont("Inter", "normal");
        
        const activeFaults = Object.keys(state.faults).filter(k => state.faults[k]);
        if (activeFaults.length > 0) {
            doc.setTextColor(239, 68, 68);
            doc.text(`FAULT DETECTED: [${activeFaults.map(f => f.toUpperCase()).join(", ")} Stage failure active]`, 53, yPos + 27);
        } else {
            doc.setTextColor(16, 185, 129);
            doc.text("HEALTHY (No active faults injected)", 53, yPos + 27);
        }
        
        // Add Dashboard Visual Snapshot
        doc.setTextColor(15, 23, 42);
        doc.setFont("Inter", "bold");
        doc.setFontSize(12);
        doc.text("2. Oscilloscope & Flow Visualization Snapshot", 14, 98);
        
        // Calculate image aspect ratio to fit width
        const imgWidth = 182; // mm width inside margins
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        doc.addImage(imgData, 'PNG', 14, 104, imgWidth, imgHeight);
        
        // Bottom Footer
        doc.setFont("Inter", "italic");
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text("Google DeepMind Antigravity ECE Virtual Lab System - Page 1 of 1", pageWidth / 2, pageHeight - 10, { align: "center" });

        // Save PDF file
        doc.save(`Superheterodyne_Receiver_Lab_Report_${state.preset.toUpperCase()}.pdf`);
        
        // Re-enable button
        buttons.exportPdf.disabled = false;
        buttons.exportPdf.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Generate PDF';
    });
}

// --- EVENT HANDLERS REGISTRATION ---
function registerEventHandlers() {
    // Sliders listeners
    sliders.rfFreq.addEventListener('input', (e) => {
        state.rfFreq = parseFloat(e.target.value);
        updateFrequencyUI();
    });
    sliders.loFreq.addEventListener('input', (e) => {
        state.loFreq = parseFloat(e.target.value);
        updateFrequencyUI();
    });
    sliders.ifFreq.addEventListener('input', (e) => {
        state.ifFreq = parseFloat(e.target.value);
        texts.ifFreq.textContent = state.ifFreq;
        updateDynamicMath();
        updateAudio();
    });
    sliders.rfAmp.addEventListener('input', (e) => {
        state.rfAmp = parseFloat(e.target.value);
        texts.rfAmp.textContent = state.rfAmp;
        numInputs.rfAmp.value = state.rfAmp;
        updateAudio();
    });
    sliders.noiseLvl.addEventListener('input', (e) => {
        state.noiseLevel = parseFloat(e.target.value);
        texts.noiseLvl.textContent = state.noiseLevel;
        numInputs.noiseLvl.value = state.noiseLevel;
        updateAudio();
    });
    sliders.gain.addEventListener('input', (e) => {
        state.gain = parseFloat(e.target.value);
        texts.gain.textContent = state.gain;
        numInputs.gain.value = state.gain;
        updateAudio();
    });
    sliders.audioVol.addEventListener('input', (e) => {
        state.audioVolume = parseInt(e.target.value);
        updateAudio();
    });

    // Mirror numeric boxes changes to sliders
    numInputs.rfFreq.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        const p = presets[state.preset];
        const scaledVal = state.frequencyMode === 'AM' ? val : val * 1000;
        if (scaledVal >= p.rfMin && scaledVal <= p.rfMax) {
            state.rfFreq = scaledVal;
            updateFrequencyUI();
        } else {
            updateFrequencyUI(); // restore valid value
        }
    });
    numInputs.loFreq.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        const p = presets[state.preset];
        const scaledVal = state.frequencyMode === 'AM' ? val : val * 1000;
        if (scaledVal >= p.loMin && scaledVal <= p.loMax) {
            state.loFreq = scaledVal;
            updateFrequencyUI();
        } else {
            updateFrequencyUI(); // restore valid value
        }
    });
    numInputs.rfAmp.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 5 && val <= 500) {
            state.rfAmp = val;
            sliders.rfAmp.value = val;
            texts.rfAmp.textContent = val;
            updateAudio();
        }
    });
    numInputs.noiseLvl.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 0 && val <= 100) {
            state.noiseLevel = val;
            sliders.noiseLvl.value = val;
            texts.noiseLvl.textContent = val;
            updateAudio();
        }
    });
    numInputs.gain.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 0 && val <= 80) {
            state.gain = val;
            sliders.gain.value = val;
            texts.gain.textContent = val;
            updateAudio();
        }
    });

    // Preset buttons clicks
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            loadPreset(e.target.dataset.preset);
        });
    });

    // Play/Pause/Reset Buttons
    buttons.start.addEventListener('click', () => {
        state.isRunning = true;
        buttons.start.disabled = true;
        buttons.pause.disabled = false;
        
        initAudio();
        updateAudio();
        updateSignalFlowVisuals();
    });
    buttons.pause.addEventListener('click', () => {
        state.isRunning = false;
        buttons.start.disabled = false;
        buttons.pause.disabled = true;
        
        updateAudio();
        updateSignalFlowVisuals();
    });
    buttons.reset.addEventListener('click', () => {
        // Clear faults
        document.querySelectorAll('.fault-trigger').forEach(trig => { trig.checked = false; });
        state.faults = { rf: false, mixer: false, lo: false, if: false };
        document.getElementById('fault-alert-banner').classList.add('hidden');
        
        // Reset parameters to preset defaults
        loadPreset(state.preset);
        
        state.isRunning = true;
        buttons.start.disabled = true;
        buttons.pause.disabled = false;
        
        updateSignalFlowVisuals();
    });
    
    // Auto Tune
    buttons.autotune.addEventListener('click', runAutoTune);
    
    // Mute control
    buttons.audioMute.addEventListener('click', () => {
        state.audioMuted = !state.audioMuted;
        buttons.audioMute.innerHTML = state.audioMuted ? 
            '<i class="fa-solid fa-volume-xmark"></i>' : 
            '<i class="fa-solid fa-volume-high"></i>';
        buttons.audioMute.classList.toggle('btn-secondary', state.audioMuted);
        updateAudio();
    });
    
    // Clickable stages in SVG
    document.querySelectorAll('.clickable').forEach(block => {
        block.addEventListener('click', (e) => {
            const stage = e.currentTarget.dataset.stage;
            showStageDetails(stage);
        });
    });

    // Tab switching (Oscilloscope vs Spectrum)
    document.querySelectorAll('.plot-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => {
            document.querySelectorAll('.plot-tab-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const target = e.currentTarget.dataset.tab;
            document.getElementById('tab-oscilloscopes').classList.toggle('hidden', target !== 'oscilloscopes');
            document.getElementById('tab-spectrum').classList.toggle('hidden', target !== 'spectrum');
            
            // Recalculate size of Chart.js on tab change
            if (target === 'spectrum' && spectrumChart) {
                setTimeout(() => {
                    spectrumChart.resize();
                }, 50);
            }
        });
    });
    
    // Reset Zoom FFT
    buttons.resetZoom.addEventListener('click', () => {
        if (spectrumChart) {
            spectrumChart.resetZoom();
        }
    });

    // Export Screenshots/PDFs
    buttons.exportImg.addEventListener('click', exportDashboardScreenshot);
    buttons.exportPdf.addEventListener('click', exportPDFReport);
}

// --- CORE ANIMATION & DRAWING FRAME LOOP ---
function runSimulationLoop() {
    if (state.isRunning) {
        // 1. Calculate the real-time mathematical signals
        const waves = calculateWaveforms();
        
        // 2. Draw the 5 stacked oscilloscope graphs
        drawOscilloscopes(waves);
        
        // 3. Update the spectrum values continuously (modulated by noise)
        updateSpectrumChart();
    }
    
    // Continuous loop
    requestAnimationFrame(runSimulationLoop);
}

// --- INIT APP ---
window.addEventListener('load', () => {
    // Render initial equations
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(document.body, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false}
            ],
            throwOnError: false
        });
    }
    
    initDOMElements();
    initTuningKnob();
    initSpectrumChart();
    initLearningMode();
    initFaultConsole();
    
    registerEventHandlers();
    
    // Load AM default preset initially
    loadPreset('am');
    
    // Trigger initial SVG outline rendering
    updateSignalFlowVisuals();
    
    // Focus antenna stage default
    showStageDetails('antenna');
    
    // Start continuous loops
    runSimulationLoop();
});
