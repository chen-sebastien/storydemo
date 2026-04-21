import soundfile as sf
import pyloudnorm as pyln
import numpy as np

def process_file(filename, target_lufs=-14.0, max_true_peak_db=1.0):
    print(f"Processing {filename}...")
    data, rate = sf.read(filename)
    
    # Measure integrated loudness
    meter = pyln.Meter(rate)
    loudness = meter.integrated_loudness(data)
    print(f"Original loudness: {loudness:.2f} LUFS")
    
    # Normalize to target LUFS
    # We aim for -11.5 LUFS (right in the middle of -14 and -9)
    # The user asked for "1.0 dBTP or lower". We'll use 1.0 as the cap.
    normalized = pyln.normalize.loudness(data, loudness, target_lufs)
    
    # Measure peak (absolute max sample value)
    peak = np.max(np.abs(normalized))
    peak_db = 20 * np.log10(peak) if peak > 0 else -100
    print(f"Loudness normalized peak: {peak_db:.2f} dBFS")
    
    # If peak goes above the true peak limit, scale it down.
    if peak_db > max_true_peak_db:
        print(f"Peak {peak_db:.2f} dBFS exceeds max {max_true_peak_db} dBTP! Scaling down...")
        scale = (10 ** (max_true_peak_db / 20)) / peak
        normalized = normalized * scale
        final_loudness = meter.integrated_loudness(normalized)
        print(f"Final loudness after peak scaling: {final_loudness:.2f} LUFS")
    else:
        final_loudness = meter.integrated_loudness(normalized)
        print(f"Final loudness: {final_loudness:.2f} LUFS")
        
    sf.write(filename, normalized, rate)
    print(f"Saved {filename}\n")

if __name__ == "__main__":
    process_file('BGM Ruin remix.wav', target_lufs=-11.5, max_true_peak_db=1.0)
    process_file('desert clean.wav', target_lufs=-11.5, max_true_peak_db=1.0)
